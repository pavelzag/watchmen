import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { fetchAwsSnapshot } from "@/lib/aws"; // Integrated AWS
import { useMockData } from "@/lib/gcp/client";
import { useMockAwsData } from "@/lib/aws/client"; // Integrated AWS
import { extractIntent, generateAnswer, extractResources } from "@/lib/claude/query-processor";
import { callAI, resolveAI, type AIProvider } from "@/lib/ai/client";
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable, ensureAgentInstallTables } from "@/lib/db"; // Added AWS table ensure
import { getGcpAuthFailures } from "@/lib/gcp/auth-failures";
import { getAwsAuthFailures } from "@/lib/aws/auth-failures";
import { getMockScanResults } from "@/lib/container-scanning";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";
import { getAwsRegions } from "@/lib/aws/client";

const REQUEST_LOG_SAMPLE_LIMIT = 200;

type SnapshotRow = {
  snapshot: any;
  fetched_at?: string | Date;
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function classifyStatus(status: unknown): string {
  const n = Number(status);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 200 && n < 300) return "2xx";
  if (n >= 300 && n < 400) return "3xx";
  if (n >= 400 && n < 500) return "4xx";
  if (n >= 500 && n < 600) return "5xx";
  return "other";
}

function parseCapturedHttp(raw: unknown): {
  contentType?: string;
  traceId?: string;
  traceSource?: string;
  payloadBytes?: string;
  queryParams?: Record<string, string>;
} {
  if (typeof raw !== "string" || !raw) return {};

  const normalized = raw.replace(/\r\n/g, "\n");
  const [head] = normalized.split(/\n\n/);
  const lines = head.split("\n").filter(Boolean);
  const firstLine = lines[0] ?? "";
  const headers: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }

  const path = firstLine.match(/^[A-Z]+\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/)?.[1];
  let queryParams: Record<string, string> | undefined;
  if (path) {
    try {
      const entries = [...new URL(path, "http://watchmen.local").searchParams.entries()];
      queryParams = entries.length > 0 ? Object.fromEntries(entries) : undefined;
    } catch {
      queryParams = undefined;
    }
  }

  return {
    contentType: headers["content-type"],
    traceId: headers["x-watchmen-trace-id"] ?? queryParams?.watchmen_trace_probe,
    traceSource: headers["x-watchmen-trace-source"],
    payloadBytes: headers["x-watchmen-payload-bytes"],
    queryParams,
  };
}

function increment(map: Record<string, number>, key: unknown) {
  const normalized = String(key || "unknown");
  map[normalized] = (map[normalized] ?? 0) + 1;
}

async function fetchProcessorHistory() {
  const processorUrl = process.env.PROCESSOR_URL;
  if (!processorUrl) {
    return {
      available: false,
      source: "PROCESSOR_URL is not configured",
      retention: "No request processor history was fetched.",
      recent: [],
    };
  }

  try {
    const baseUrl = processorUrl.replace(/\/$/, "");
    const resp = await fetch(`${baseUrl}/api/history`, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      next: { revalidate: 0 },
    });
    if (!resp.ok) {
      return {
        available: false,
        source: `${baseUrl}/api/history`,
        error: `Request processor returned HTTP ${resp.status}`,
        retention: "The request processor keeps only its in-memory recent history.",
        recent: [],
      };
    }
    const data = await resp.json();
    const history = Array.isArray(data) ? data : (data?.history ?? []);
    return {
      available: true,
      source: `${baseUrl}/api/history`,
      retention: "In-memory ring buffer in services/request-processor; currently maxHistory=10, reset when the processor restarts.",
      totalReturned: history.length,
      recent: history.slice(0, 10).map((item: any) => ({
        requestId: item.request_id,
        source: item.source,
        message: item.message,
        receivedAt: item.received_at ?? item.timestamp ?? item.trace?.[0]?.time,
        targetUrl: item.target_url,
        traceSteps: Array.isArray(item.trace) ? item.trace.length : 0,
      })),
    };
  } catch (err) {
    return {
      available: false,
      source: `${processorUrl.replace(/\/$/, "")}/api/history`,
      error: err instanceof Error ? err.message : "Failed to fetch processor history",
      retention: "The request processor keeps only its in-memory recent history.",
      recent: [],
    };
  }
}

async function buildRequestLogContext(userEmail: string) {
  await ensureAgentInstallTables();

  const aggregate = await sql`
    SELECT
      COUNT(*)::int AS total,
      MIN(e.received_at) AS oldest_received_at,
      MAX(e.received_at) AS newest_received_at
    FROM agent_events e
    JOIN agent_hosts h ON h.id = e.agent_id
    WHERE h.user_email = ${userEmail}
       OR h.user_email = 'system'
  `;

  const events = await sql`
    SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, h.metadata->>'clusterName' AS cluster_name
    FROM agent_events e
    JOIN agent_hosts h ON h.id = e.agent_id
    WHERE h.user_email = ${userEmail}
       OR h.user_email = 'system'
    ORDER BY e.received_at DESC
    LIMIT ${REQUEST_LOG_SAMPLE_LIMIT}
  `;

  const methods: Record<string, number> = {};
  const paths: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  const statusClasses: Record<string, number> = {};
  const clusters: Record<string, number> = {};
  const hosts: Record<string, number> = {};
  const agents: Record<string, number> = {};
  const traceSources: Record<string, number> = {};

  const recent = events.rows.map((row: any) => {
    const ev = row.event ?? {};
    const parsed = parseCapturedHttp(ev.data);
    const method = ev.method ?? (ev.type === "http_response" ? "RESPONSE" : "unknown");
    const path = ev.path ?? "unknown";
    const status = ev.status ?? null;

    increment(methods, method);
    if (ev.path) increment(paths, path);
    if (status) {
      increment(statuses, status);
      increment(statusClasses, classifyStatus(status));
    }
    increment(clusters, row.cluster_name);
    increment(hosts, ev.hostname);
    increment(agents, row.agent_id);
    if (parsed.traceSource) increment(traceSources, parsed.traceSource);

    return {
      id: row.id,
      agentId: row.agent_id,
      provider: row.provider,
      projectId: row.project_id,
      clusterName: row.cluster_name,
      receivedAt: toIso(row.received_at),
      type: ev.type,
      method,
      path,
      status,
      hostname: ev.hostname,
      process: ev.comm,
      pid: ev.pid,
      traceId: parsed.traceId,
      traceSource: parsed.traceSource,
      contentType: parsed.contentType,
      payloadBytes: parsed.payloadBytes,
      queryParams: parsed.queryParams,
      rawPreview: typeof ev.data === "string" ? ev.data.slice(0, 500) : undefined,
    };
  });

  const processor = await fetchProcessorHistory();
  const totals = aggregate.rows[0] ?? {};

  return {
    durableAgentEvents: {
      source: "Postgres agent_events joined to agent_hosts by authenticated user",
      retention: "Durable rows retained until deleted by database maintenance; this query aggregates all matching rows and includes the newest sample.",
      totalEvents: Number(totals.total ?? 0),
      oldestReceivedAt: toIso(totals.oldest_received_at),
      newestReceivedAt: toIso(totals.newest_received_at),
      sampleLimit: REQUEST_LOG_SAMPLE_LIMIT,
      sampledEvents: recent.length,
      breakdownsFromSample: {
        methods,
        paths,
        statuses,
        statusClasses,
        clusters,
        hosts,
        agents,
        traceSources,
      },
      recent,
    },
    requestProcessorHistory: processor,
  };
}

function buildSourceInventory(params: {
  gcpSnapshot: any;
  gcpFetchedAt?: unknown;
  awsSnapshot: any;
  awsFetchedAt?: unknown;
  isGcpMock: boolean;
  isAwsMock: boolean;
}) {
  return {
    askAi: {
      route: "/api/query",
      flow: "The browser sends the question to /api/query. The server resolves the user's AI provider/key, extracts a structured intent, builds a minimal context from local/cloud data sources, then sends only that context plus the question to the selected AI provider.",
      aiProviders: "OpenAI, Anthropic, or Google, depending on the active key in Settings or browser demo credentials.",
      privacyBoundary: "Ask AI does not browse the internet. It uses the context assembled by this route and sends that context to the configured AI provider.",
    },
    snapshots: {
      gcp: {
        available: Boolean(params.gcpSnapshot),
        mode: params.isGcpMock ? "mock/demo via fetchGcpSnapshot(forceMock)" : "stored Postgres snapshot",
        store: params.isGcpMock ? "fixtures and mock scenario modules" : "user_snapshots.snapshot JSONB",
        fetchedAt: toIso(params.gcpFetchedAt ?? params.gcpSnapshot?.fetchedAt),
        includes: [
          "projects/IAM policies",
          "service accounts and keys",
          "storage buckets",
          "GKE clusters",
          "VMs",
          "Cloud Run services",
          "Cloud SQL",
          "BigQuery",
          "Pub/Sub",
          "Secret Manager",
          "firewall rules",
          "load balancers",
          "scan warnings",
        ],
      },
      aws: {
        available: Boolean(params.awsSnapshot),
        mode: params.isAwsMock ? "mock/demo via fetchAwsSnapshot(forceMock)" : "stored Postgres snapshot",
        store: params.isAwsMock ? "fixtures/aws mock modules" : "aws_snapshots.snapshot JSONB",
        fetchedAt: toIso(params.awsFetchedAt ?? params.awsSnapshot?.fetchedAt),
        includes: [
          "accounts and regions",
          "IAM users and roles",
          "S3 buckets",
          "EKS clusters",
          "EC2 instances",
          "Lambda functions",
          "RDS and Redshift",
          "SNS topics",
          "Secrets Manager",
          "security groups",
          "load balancers",
        ],
      },
    },
    requestLogs: {
      durableAgentEvents: "agent_events.event JSONB receives eBPF/Kubernetes agent HTTP request/response events through /api/agents/events; rows are associated with agent_hosts.",
      requestProcessorHistory: "services/request-processor keeps a process-local in-memory history with maxHistory=10 and exposes it at PROCESSOR_URL/api/history.",
      traceHistoryApi: "/api/trace/history merges durable agent events with request processor history for the UI.",
    },
    liveOnDemandSources: {
      authFailures: "For auth log questions, /api/query calls GCP/AWS auth failure collectors on demand for the requested time window.",
      containerScans: "For container vulnerability questions, /api/query calls GCP Container Analysis, AWS ECR scanning, GHCR, and Docker Hub integrations when not in mock mode.",
    },
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // Resolve the user's AI key: check body first (browser-only), then fallback to DB
  let provider: AIProvider;
  let apiKey: string;
  const ALLOWED_PROVIDERS: AIProvider[] = ["openai", "anthropic", "google"];
  const browserKey = (body as any)?.demoCredentials?.aiKey;
  const browserProvider = (body as any)?.demoCredentials?.aiProvider;

  if (browserKey && browserProvider) {
    if (!ALLOWED_PROVIDERS.includes(browserProvider)) {
      return NextResponse.json({ error: "Invalid AI provider." }, { status: 400 });
    }
    provider = browserProvider as AIProvider;
    apiKey = browserKey;
  } else {
    try {
      const resolved = await resolveAI(session.user.email, session.isDemoUser);
      provider = resolved.provider;
      apiKey = resolved.key;
    } catch (err: any) {
      if (err.message === "DEMO_LIMIT_REACHED") {
        return NextResponse.json(
          { error: "Daily demo AI limit reached (20 queries). Please provide your own Gemini/Claude key in Settings to continue." },
          { status: 429 }
        );
      }
      if (err.message === "GLOBAL_LIMIT_REACHED") {
        return NextResponse.json(
          { error: "Global daily demo AI limit reached. Please try again tomorrow or provide your own API key in Settings." },
          { status: 429 }
        );
      }
      const demoMsg = session.isDemoUser
        ? " (or provide your own API key in Settings)"
        : " in Settings";
      return NextResponse.json(
        { error: `No AI key configured${demoMsg}.` },
        { status: 422 }
      );
    }
  }

  const query: string = body?.query?.trim();
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Query must be at least 3 characters." }, { status: 400 });
  }
  if (query.length > 500) {
    return NextResponse.json({ error: "Query must be under 500 characters." }, { status: 400 });
  }

  try {
    let gcpSnapshot;
    let awsSnapshot;
    let gcpFetchedAt: unknown;
    let awsFetchedAt: unknown;
    const isGcpMock = useMockData() || Boolean(session.isDemoUser);
    const isAwsMock = useMockAwsData() || Boolean(session.isDemoUser);

    // GCP Snapshot fetch
    if (isGcpMock) {
      gcpSnapshot = await fetchGcpSnapshot({ forceMock: true });
      gcpFetchedAt = gcpSnapshot?.fetchedAt;
    } else {
      await ensureGcpSnapshotTable();
      const result = await sql`
        SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length > 0) {
        const row = result.rows[0] as SnapshotRow;
        gcpSnapshot = row.snapshot;
        gcpFetchedAt = row.fetched_at;
        if (gcpSnapshot && gcpFetchedAt) gcpSnapshot.fetchedAt = toIso(gcpFetchedAt) ?? gcpSnapshot.fetchedAt;
      }
    }

    // AWS Snapshot fetch
    if (isAwsMock) {
      awsSnapshot = await fetchAwsSnapshot({ forceMock: true });
      awsFetchedAt = awsSnapshot?.fetchedAt;
    } else {
      await ensureAwsSnapshotTable();
      const result = await sql`
        SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length > 0) {
        const row = result.rows[0] as SnapshotRow;
        awsSnapshot = row.snapshot;
        awsFetchedAt = row.fetched_at;
        if (awsSnapshot && awsFetchedAt) awsSnapshot.fetchedAt = toIso(awsFetchedAt) ?? awsSnapshot.fetchedAt;
      }
    }

    // Inject Scenario data for the AI to "know" about the trace options
    let scenarioContext = null;
    if (session.isDemoUser || process.env.USE_MOCK_DATA === "true") {
      const { SCENARIOS } = await import("@/lib/mock/scenarios");
      scenarioContext = SCENARIOS.map(s => ({
        id: s.id,
        label: s.label,
        description: s.description,
        provider: s.provider,
        nodes: s.nodes.map(n => n.label).join(" -> ")
      }));
    }

    const intent = await extractIntent(query, provider, apiKey);
    const canAnswerWithoutSnapshots = intent.queryType === "request_logs" || intent.queryType === "data_sources";
    if (!gcpSnapshot && !awsSnapshot && !canAnswerWithoutSnapshots) {
      return NextResponse.json(
        { error: "No snapshots yet. Please wait for the initial scan." },
        { status: 404 }
      );
    }

    const combinedSnapshot: any = { gcp: gcpSnapshot, aws: awsSnapshot };
    combinedSnapshot.sourceInventory = buildSourceInventory({
      gcpSnapshot,
      gcpFetchedAt,
      awsSnapshot,
      awsFetchedAt,
      isGcpMock,
      isAwsMock,
    });
    if (scenarioContext) combinedSnapshot.trace_scenarios = scenarioContext;

    // For auth log queries, fetch live data on-demand instead of using the snapshot
    if (intent.queryType === "auth_logs") {
      const hours = intent.logHours ?? 2;
      const isMock = useMockData() || session.isDemoUser;
      const isAwsMock = useMockAwsData() || session.isDemoUser;
      const gcpProjects = gcpSnapshot?.projects?.map((p: any) => p.projectId).filter(Boolean) ?? [];
      const awsAccounts = awsSnapshot?.accounts ?? [];

      const [gcpFailures, awsFailures] = await Promise.all([
        gcpProjects.length > 0 || isMock
          ? getGcpAuthFailures(gcpProjects, hours, isMock || undefined)
          : Promise.resolve([]),
        awsAccounts.length > 0 || isAwsMock
          ? getAwsAuthFailures(awsAccounts, hours, isAwsMock || undefined)
          : Promise.resolve([]),
      ]);

      combinedSnapshot.authFailures = {
        windowHours: hours,
        gcp: gcpFailures,
        aws: awsFailures,
        totalCount: gcpFailures.length + awsFailures.length,
      };
    }

    if (intent.queryType === "container_vulnerabilities") {
      const isMock = useMockData() || session.isDemoUser;
      const isAwsMock = useMockAwsData() || session.isDemoUser;

      if (isMock && isAwsMock) {
        combinedSnapshot.containerScans = getMockScanResults();
      } else {
        const gcpProjects = gcpSnapshot?.projects?.map((p: any) => p.projectId).filter(Boolean) ?? [];
        const awsRegions = getAwsRegions();

        const [gcpResultsList, awsResultsList, ghcrResults, dockerHubResults] = await Promise.all([
          Promise.all(gcpProjects.map((pid: string) => (!isMock ? getGcpContainerVulnerabilities(pid) : []))),
          Promise.all(awsRegions.map((region: string) => (!isAwsMock ? getAwsContainerVulnerabilities(region) : []))),
          getGhcrVulnerabilities(session.user.email),
          getDockerHubVulnerabilities(session.user.email)
        ]);

        const results = [
          ...gcpResultsList.flat(),
          ...awsResultsList.flat(),
          ...ghcrResults,
          ...dockerHubResults,
          ...(isMock ? getMockScanResults().filter(r => r.cloud === "gcp") : []),
          ...(isAwsMock ? getMockScanResults().filter(r => r.cloud === "aws") : [])
        ];

        combinedSnapshot.containerScans = results;
      }
    }

    if (intent.queryType === "request_logs" || intent.queryType === "data_sources" || intent.queryType === "connected_projects") {
      combinedSnapshot.requestLogs = await buildRequestLogContext(session.user.email);
    }

    const [answer, resources] = await Promise.all([
      generateAnswer(query, intent, combinedSnapshot, provider, apiKey),
      Promise.resolve(extractResources(intent, { gcp: gcpSnapshot, aws: awsSnapshot })),
    ]);

    return NextResponse.json({
      query,
      intent,
      answer,
      resources,
      fetchedAt: gcpSnapshot?.fetchedAt || awsSnapshot?.fetchedAt
    });
  } catch (err) {
    console.error("[api/query] error:", err);
    return NextResponse.json({ error: "Failed to process query. Check server logs." }, { status: 500 });
  }
}
