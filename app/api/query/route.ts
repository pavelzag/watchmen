import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { fetchAwsSnapshot } from "@/lib/aws"; // Integrated AWS
import { initGoogleAuthFromKey, initUserAuth, useMockData } from "@/lib/gcp/client";
import { useMockAwsData } from "@/lib/aws/client"; // Integrated AWS
import { extractIntent, generateAnswer, extractResources, type QueryIntent } from "@/lib/claude/query-processor";
import { callAI, resolveAI, type AIProvider } from "@/lib/ai/client";
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable, ensureAgentInstallTables } from "@/lib/db"; // Added AWS table ensure
import { getUserCloudCredentials } from "@/lib/credentials";
import { getClusterEntryPoints } from "@/lib/gcp/cluster-entrypoints";
import { getGcpAuthFailures } from "@/lib/gcp/auth-failures";
import { getAwsAuthFailures } from "@/lib/aws/auth-failures";
import { getMockScanResults } from "@/lib/container-scanning";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";
import { getAwsRegions } from "@/lib/aws/client";

const REQUEST_LOG_SAMPLE_LIMIT = 50;

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

type QueryLogger = {
  queryId: string;
  startedAt: number;
  currentStep?: string;
};

function logQueryStep(logger: QueryLogger | undefined, step: string, data: Record<string, unknown> = {}) {
  if (!logger) return;
  logger.currentStep = step;
  console.info(`[api/query:${logger.queryId}] ${step}`, {
    elapsedMs: Date.now() - logger.startedAt,
    ...data,
  });
}

function createQueryWatchdogs(logger: QueryLogger): Array<ReturnType<typeof setTimeout>> {
  return [5000, 15000, 25000].map((ms) =>
    setTimeout(() => {
      console.warn(`[api/query:${logger.queryId}] watchdog`, {
        elapsedMs: Date.now() - logger.startedAt,
        thresholdMs: ms,
        currentStep: logger.currentStep ?? "unknown",
      });
    }, ms)
  );
}

function clearQueryWatchdogs(watchdogs: Array<ReturnType<typeof setTimeout>>) {
  for (const watchdog of watchdogs) clearTimeout(watchdog);
}

function increment(map: Record<string, number>, key: unknown) {
  const normalized = String(key || "unknown");
  map[normalized] = (map[normalized] ?? 0) + 1;
}

async function fetchProcessorHistory(logger?: QueryLogger) {
  const processorUrl = process.env.PROCESSOR_URL;
  if (!processorUrl) {
    logQueryStep(logger, "processor history skipped", { reason: "PROCESSOR_URL missing" });
    return {
      available: false,
      source: "PROCESSOR_URL is not configured",
      retention: "No request processor history was fetched.",
      recent: [],
    };
  }

  try {
    const baseUrl = processorUrl.replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    logQueryStep(logger, "processor history fetch start", { source: `${baseUrl}/api/history` });
    const resp = await fetch(`${baseUrl}/api/history`, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      next: { revalidate: 0 },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    logQueryStep(logger, "processor history fetch complete", { status: resp.status, ok: resp.ok });
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
    logQueryStep(logger, "processor history parsed", { returned: history.length });
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
    logQueryStep(logger, "processor history fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      available: false,
      source: `${processorUrl.replace(/\/$/, "")}/api/history`,
      error: err instanceof Error ? err.message : "Failed to fetch processor history",
      retention: "The request processor keeps only its in-memory recent history.",
      recent: [],
    };
  }
}

async function buildRequestLogContext(userEmail: string, logger?: QueryLogger) {
  logQueryStep(logger, "agent tables ensure start");
  await ensureAgentInstallTables();
  logQueryStep(logger, "agent tables ensure complete");

  logQueryStep(logger, "agent aggregate query start");
  const aggregate = await sql`
    SELECT
      COUNT(*)::int AS total_events,
      COUNT(*) FILTER (WHERE e.event->>'type' = 'http_request')::int AS total_requests,
      COUNT(*) FILTER (WHERE e.event->>'type' = 'http_response')::int AS total_responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int >= 400
      )::int AS erroneous_responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int BETWEEN 400 AND 499
      )::int AS client_error_responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int >= 500
      )::int AS server_error_responses,
      MIN(e.received_at) AS oldest_received_at,
      MAX(e.received_at) AS newest_received_at
    FROM agent_events e
    JOIN agent_hosts h ON h.id = e.agent_id
    WHERE h.user_email = ${userEmail}
       OR h.user_email = 'system'
  `;
  const totals = aggregate.rows[0] ?? {};
  logQueryStep(logger, "agent aggregate query complete", {
    totalEvents: Number(totals.total_events ?? 0),
    totalRequests: Number(totals.total_requests ?? 0),
    totalResponses: Number(totals.total_responses ?? 0),
    erroneousResponses: Number(totals.erroneous_responses ?? 0),
  });

  logQueryStep(logger, "agent cluster stats query start");
  const clusterStats = await sql`
    SELECT
      COALESCE(h.metadata->>'clusterName', 'unknown') AS cluster_name,
      COUNT(*) FILTER (WHERE e.event->>'type' = 'http_request')::int AS requests,
      COUNT(*) FILTER (WHERE e.event->>'type' = 'http_response')::int AS responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int >= 400
      )::int AS erroneous_responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int BETWEEN 400 AND 499
      )::int AS client_error_responses,
      COUNT(*) FILTER (
        WHERE e.event->>'type' = 'http_response'
          AND e.event->>'status' ~ '^[0-9]{3}$'
          AND (e.event->>'status')::int >= 500
      )::int AS server_error_responses,
      MIN(e.received_at) AS oldest_received_at,
      MAX(e.received_at) AS newest_received_at
    FROM agent_events e
    JOIN agent_hosts h ON h.id = e.agent_id
    WHERE h.user_email = ${userEmail}
       OR h.user_email = 'system'
    GROUP BY COALESCE(h.metadata->>'clusterName', 'unknown')
    ORDER BY erroneous_responses DESC, requests DESC
    LIMIT 20
  `;
  logQueryStep(logger, "agent cluster stats query complete", {
    clusterRows: clusterStats.rows.length,
    clusters: clusterStats.rows.slice(0, 5).map((row: any) => row.cluster_name),
  });

  logQueryStep(logger, "agent recent events query start", { limit: REQUEST_LOG_SAMPLE_LIMIT });
  const events = await sql`
    SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, h.metadata->>'clusterName' AS cluster_name
    FROM agent_events e
    JOIN agent_hosts h ON h.id = e.agent_id
    WHERE h.user_email = ${userEmail}
       OR h.user_email = 'system'
    ORDER BY e.received_at DESC
    LIMIT ${REQUEST_LOG_SAMPLE_LIMIT}
  `;
  logQueryStep(logger, "agent recent events query complete", { rows: events.rows.length });

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
      rawPreview: typeof ev.data === "string" ? ev.data.slice(0, 200) : undefined,
    };
  });

  logQueryStep(logger, "agent recent events normalize complete", {
    sampledEvents: recent.length,
    methodKeys: Object.keys(methods),
    statusClassKeys: Object.keys(statusClasses),
  });

  const processor = await fetchProcessorHistory(logger);
  logQueryStep(logger, "request log context assembled", {
    processorAvailable: processor.available,
    totalEvents: Number(totals.total_events ?? 0),
    sampledEvents: recent.length,
  });

  return {
    durableAgentEvents: {
      source: "Postgres agent_events joined to agent_hosts by authenticated user",
      retention: "Durable rows retained until deleted by database maintenance; this query aggregates all matching rows and includes the newest sample.",
      totalEvents: Number(totals.total_events ?? 0),
      totalRequests: Number(totals.total_requests ?? 0),
      totalResponses: Number(totals.total_responses ?? 0),
      erroneousResponses: Number(totals.erroneous_responses ?? 0),
      clientErrorResponses: Number(totals.client_error_responses ?? 0),
      serverErrorResponses: Number(totals.server_error_responses ?? 0),
      oldestReceivedAt: toIso(totals.oldest_received_at),
      newestReceivedAt: toIso(totals.newest_received_at),
      clusterStats: clusterStats.rows.map((row: any) => ({
        clusterName: row.cluster_name,
        requests: Number(row.requests ?? 0),
        responses: Number(row.responses ?? 0),
        erroneousResponses: Number(row.erroneous_responses ?? 0),
        clientErrorResponses: Number(row.client_error_responses ?? 0),
        serverErrorResponses: Number(row.server_error_responses ?? 0),
        oldestReceivedAt: toIso(row.oldest_received_at),
        newestReceivedAt: toIso(row.newest_received_at),
      })),
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

function findRequestedCluster(query: string, requestLogs: any): string | null {
  const clusters: string[] = requestLogs?.durableAgentEvents?.clusterStats?.map((row: any) => row.clusterName).filter(Boolean) ?? [];
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clusters.find((cluster) => normalizedQuery.includes(cluster.toLowerCase().replace(/[^a-z0-9]/g, ""))) ?? null;
}

function formatRequestLogAnswer(query: string, requestLogs: any): string {
  const durable = requestLogs?.durableAgentEvents ?? {};
  const requestedCluster = findRequestedCluster(query, requestLogs);
  const clusterRows = durable.clusterStats ?? [];
  const row = requestedCluster
    ? clusterRows.find((item: any) => item.clusterName === requestedCluster)
    : null;
  const scope = row ?? durable;
  const scopeLabel = requestedCluster ? `cluster **${requestedCluster}**` : "all observed clusters";

  const lines = [
    `For ${scopeLabel}:`,
    `- **Requests observed:** ${scope.requests ?? durable.totalRequests ?? 0}`,
    `- **Responses observed:** ${scope.responses ?? durable.totalResponses ?? 0}`,
    `- **Erroneous responses (HTTP 4xx/5xx):** ${scope.erroneousResponses ?? durable.erroneousResponses ?? 0}`,
    `- **Client errors (4xx):** ${scope.clientErrorResponses ?? durable.clientErrorResponses ?? 0}`,
    `- **Server errors (5xx):** ${scope.serverErrorResponses ?? durable.serverErrorResponses ?? 0}`,
    `- **Window:** ${scope.oldestReceivedAt ?? durable.oldestReceivedAt ?? "unknown"} to ${scope.newestReceivedAt ?? durable.newestReceivedAt ?? "unknown"}`,
    "",
    `Source: **Postgres agent_events** joined to **agent_hosts**. These are Watchmen agent-captured HTTP events, not a Cloud Logging poll.`,
  ];

  if (!requestedCluster && clusterRows.length > 0) {
    lines.push("", "By cluster:");
    for (const cluster of clusterRows.slice(0, 10)) {
      lines.push(`- **${cluster.clusterName}**: ${cluster.requests} requests, ${cluster.erroneousResponses} erroneous responses (${cluster.clientErrorResponses} 4xx, ${cluster.serverErrorResponses} 5xx)`);
    }
  }

  if (requestLogs?.requestProcessorHistory?.available === false) {
    lines.push("", `Note: request processor in-memory history was not included: ${requestLogs.requestProcessorHistory.source}.`);
  }

  return lines.join("\n");
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

function shouldFetchGkeEntryPoints(query: string, intent: Awaited<ReturnType<typeof extractIntent>>): boolean {
  const q = query.toLowerCase();
  const asksAboutPublicEndpoint =
    /\b(public|open|external|internet|exposed|endpoint|ingress|load\s*balancer|loadbalancer|api server|master)\b/.test(q);
  const asksAboutGke = /\b(gke|kubernetes|cluster)\b/.test(q) || intent.resourceType === "gke_cluster";
  return Boolean(gcpRelatedIntent(intent) && asksAboutGke && asksAboutPublicEndpoint);
}

function inferFastIntent(query: string): QueryIntent | null {
  const q = query.toLowerCase();
  const mentionsRequests = /\b(requests?|responses?|traffic|http|status|4xx|5xx|errors?|erroneous|erroroneous|failed|failures?)\b/.test(q);
  const mentionsLogsOrEndpoints = /\b(logs?|gke|kubernetes|clusters?|endpoints?|ingress|load\s*balancer|sent|received)\b/.test(q);
  if (!mentionsRequests || !mentionsLogsOrEndpoints) return null;

  return {
    queryType: "request_logs",
    resourceType: /\b(gke|kubernetes|clusters?)\b/.test(q) ? "gke_cluster" : undefined,
  };
}

function gcpRelatedIntent(intent: Awaited<ReturnType<typeof extractIntent>>): boolean {
  return !intent.resourceType || [
    "gke_cluster",
    "project",
    "load_balancer",
    "firewall",
    "vm",
  ].includes(intent.resourceType);
}

function matchesLoose(value: unknown, needle: string | undefined): boolean {
  if (!needle) return true;
  if (typeof value !== "string") return false;
  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedNeedle = needle.toLowerCase().replace(/[^a-z0-9]/g, "");
  return value.toLowerCase().includes(needle.toLowerCase()) || normalizedValue.includes(normalizedNeedle);
}

async function buildGkeEntryPointContext(params: {
  email: string;
  accessToken: unknown;
  gcpSnapshot: any;
  isGcpMock: boolean;
  intent: Awaited<ReturnType<typeof extractIntent>>;
}) {
  const allClusters = params.gcpSnapshot?.gkeClusters ?? [];
  let filterWarning: string | undefined;
  let clusters = allClusters.filter((cluster: any) => {
    const projectMatch = matchesLoose(cluster.projectId, params.intent.projectId);
    const nameMatch = matchesLoose(cluster.name, params.intent.resourceName);
    return projectMatch && nameMatch;
  });

  if (clusters.length === 0) {
    clusters = allClusters;
    filterWarning = "The parsed project/name filters did not match any stored GKE cluster exactly, so endpoint discovery used all GKE clusters from the latest snapshot.";
  }

  if (clusters.length === 0) {
    return {
      available: false,
      reason: "No GKE clusters were present in the stored snapshot.",
      parsedProjectOrAccount: params.intent.projectId,
      parsedResourceName: params.intent.resourceName,
    };
  }

  if (params.isGcpMock) {
    return {
      available: true,
      source: "mock/demo mode",
      note: "GKE endpoint discovery uses live Compute APIs and is skipped in mock/demo mode.",
      clusterCount: clusters.length,
      filterWarning,
      parsedProjectOrAccount: params.intent.projectId,
      parsedResourceName: params.intent.resourceName,
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        projectId: cluster.projectId,
        location: cluster.location,
        privateCluster: cluster.privateCluster,
        masterApiEndpoint: cluster.endpoint,
        masterApiIsPublic: !cluster.privateCluster && Boolean(cluster.endpoint),
      })),
      entryPoints: clusters.map((cluster: any) => ({
        clusterName: cluster.name,
        projectId: cluster.projectId,
        type: "master-api",
        ip: cluster.endpoint,
        k8sService: "Kubernetes API Server",
        isPublic: !cluster.privateCluster && Boolean(cluster.endpoint),
      })),
    };
  }

  try {
    const gcpCreds = await getUserCloudCredentials(params.email, "gcp");
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (typeof params.accessToken === "string" && params.accessToken) {
      initUserAuth(params.accessToken);
    } else {
      return {
        available: false,
        reason: "No GCP credentials are available for live GKE endpoint discovery.",
        clusterCount: clusters.length,
        filterWarning,
        parsedProjectOrAccount: params.intent.projectId,
        parsedResourceName: params.intent.resourceName,
      };
    }

    const entryPoints = await getClusterEntryPoints(clusters);
    return {
      available: true,
      source: "live GCP Compute APIs via getClusterEntryPoints",
      clusterCount: clusters.length,
      filterWarning,
      parsedProjectOrAccount: params.intent.projectId,
      parsedResourceName: params.intent.resourceName,
      totalEntryPoints: entryPoints.length,
      publicEntryPoints: entryPoints.filter((entry) => entry.isPublic),
      privateOrInternalEntryPoints: entryPoints.filter((entry) => !entry.isPublic),
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        projectId: cluster.projectId,
        location: cluster.location,
        privateCluster: cluster.privateCluster,
        masterApiEndpoint: cluster.endpoint,
      })),
    };
  } catch (err) {
    return {
      available: false,
      reason: "Live GKE endpoint discovery failed.",
      error: err instanceof Error ? err.message : "Unknown error",
      clusterCount: clusters.length,
      filterWarning,
      parsedProjectOrAccount: params.intent.projectId,
      parsedResourceName: params.intent.resourceName,
    };
  }
}

export async function POST(req: NextRequest) {
  const queryId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const logger: QueryLogger = { queryId, startedAt, currentStep: "route invoked" };
  const watchdogs = createQueryWatchdogs(logger);
  const done = <T extends Response>(response: T): T => {
    clearQueryWatchdogs(watchdogs);
    return response;
  };

  logQueryStep(logger, "route invoked", {
    method: req.method,
    urlPath: req.nextUrl.pathname,
    vercelRegion: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? "unknown",
    hasProcessorUrl: Boolean(process.env.PROCESSOR_URL),
  });

  logQueryStep(logger, "auth start");
  let session;
  try {
    session = await auth();
  } catch (err) {
    console.error(`[api/query:${queryId}] auth failed`, {
      elapsedMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return done(NextResponse.json({ error: "Authentication failed. Check server logs." }, { status: 500 }));
  }
  logQueryStep(logger, "auth complete", {
    authenticated: Boolean(session?.user?.email),
    isDemoUser: Boolean(session?.isDemoUser),
    sessionError: session?.error,
  });
  if (!session?.user?.email) {
    return done(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }
  const email = session.user.email;

  logQueryStep(logger, "request body parse start");
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    console.error(`[api/query:${queryId}] request body parse failed`, {
      elapsedMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return done(NextResponse.json({ error: "Invalid request body." }, { status: 400 }));
  }
  logQueryStep(logger, "request body parse complete", {
    hasDemoCredentials: Boolean((body as any)?.demoCredentials),
  });

  const query: string = body?.query?.trim();
  if (!query || query.length < 3) {
    console.warn(`[api/query:${queryId}] invalid query`, { reason: "too_short", queryLength: query?.length ?? 0 });
    return done(NextResponse.json({ error: "Query must be at least 3 characters." }, { status: 400 }));
  }
  if (query.length > 500) {
    console.warn(`[api/query:${queryId}] invalid query`, { reason: "too_long", queryLength: query.length });
    return done(NextResponse.json({ error: "Query must be under 500 characters." }, { status: 400 }));
  }

  let provider: AIProvider | null = null;
  let apiKey: string | null = null;
  const resolveAiOrResponse = async (): Promise<NextResponse | null> => {
    if (provider && apiKey) return null;

    const ALLOWED_PROVIDERS: AIProvider[] = ["openai", "anthropic", "google"];
    const browserKey = (body as any)?.demoCredentials?.aiKey;
    const browserProvider = (body as any)?.demoCredentials?.aiProvider;

    if (browserKey && browserProvider) {
      logQueryStep(logger, "ai provider resolve from browser key", { browserProvider });
      if (!ALLOWED_PROVIDERS.includes(browserProvider)) {
        return done(NextResponse.json({ error: "Invalid AI provider." }, { status: 400 }));
      }
      provider = browserProvider as AIProvider;
      apiKey = browserKey;
      return null;
    }

    try {
      logQueryStep(logger, "ai provider resolve start");
      const resolved = await resolveAI(email, session.isDemoUser);
      provider = resolved.provider;
      apiKey = resolved.key;
      logQueryStep(logger, "ai provider resolve complete", { provider });
      return null;
    } catch (err: any) {
      logQueryStep(logger, "ai provider resolve failed", { message: err?.message ?? String(err) });
      if (err.message === "DEMO_LIMIT_REACHED") {
        return done(NextResponse.json(
          { error: "Daily demo AI limit reached (20 queries). Please provide your own Gemini/Claude key in Settings to continue." },
          { status: 429 }
        ));
      }
      if (err.message === "GLOBAL_LIMIT_REACHED") {
        return done(NextResponse.json(
          { error: "Global daily demo AI limit reached. Please try again tomorrow or provide your own API key in Settings." },
          { status: 429 }
        ));
      }
      const demoMsg = session.isDemoUser
        ? " (or provide your own API key in Settings)"
        : " in Settings";
      return done(NextResponse.json(
        { error: `No AI key configured${demoMsg}.` },
        { status: 422 }
      ));
    }
  };

  try {
    const fastIntent = inferFastIntent(query);
    console.info(`[api/query:${queryId}] start`, {
      email,
      queryLength: query.length,
      isDemoUser: Boolean(session.isDemoUser),
      fastIntent: fastIntent?.queryType,
    });

    let gcpSnapshot;
    let awsSnapshot;
    let gcpFetchedAt: unknown;
    let awsFetchedAt: unknown;
    const isGcpMock = useMockData() || Boolean(session.isDemoUser);
    const isAwsMock = useMockAwsData() || Boolean(session.isDemoUser);

    if (fastIntent?.queryType !== "request_logs") {
      // GCP Snapshot fetch
      if (isGcpMock) {
        gcpSnapshot = await fetchGcpSnapshot({ forceMock: true });
        gcpFetchedAt = gcpSnapshot?.fetchedAt;
      } else {
        await ensureGcpSnapshotTable();
        const result = await sql`
        SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${email}
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
          SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}
        `;
        if (result.rows.length > 0) {
          const row = result.rows[0] as SnapshotRow;
          awsSnapshot = row.snapshot;
          awsFetchedAt = row.fetched_at;
          if (awsSnapshot && awsFetchedAt) awsSnapshot.fetchedAt = toIso(awsFetchedAt) ?? awsSnapshot.fetchedAt;
        }
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

    if (!fastIntent) {
      const aiError = await resolveAiOrResponse();
      if (aiError) return done(aiError);
    }

    const intent = fastIntent ?? await extractIntent(query, provider!, apiKey!);
    console.info(`[api/query:${queryId}] intent`, {
      queryType: intent.queryType,
      resourceType: intent.resourceType,
      resourceName: intent.resourceName,
      projectId: intent.projectId,
      elapsedMs: Date.now() - startedAt,
    });
    const canAnswerWithoutSnapshots = intent.queryType === "request_logs" || intent.queryType === "data_sources";
    if (!gcpSnapshot && !awsSnapshot && !canAnswerWithoutSnapshots) {
      return done(NextResponse.json(
        { error: "No snapshots yet. Please wait for the initial scan." },
        { status: 404 }
      ));
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
          getGhcrVulnerabilities(email),
          getDockerHubVulnerabilities(email)
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
      console.info(`[api/query:${queryId}] request log context start`, { elapsedMs: Date.now() - startedAt });
      combinedSnapshot.requestLogs = await buildRequestLogContext(email, logger);
      console.info(`[api/query:${queryId}] request log context complete`, {
        elapsedMs: Date.now() - startedAt,
        totalAgentEvents: combinedSnapshot.requestLogs?.durableAgentEvents?.totalEvents,
        totalRequests: combinedSnapshot.requestLogs?.durableAgentEvents?.totalRequests,
        erroneousResponses: combinedSnapshot.requestLogs?.durableAgentEvents?.erroneousResponses,
        clusterStatsRows: combinedSnapshot.requestLogs?.durableAgentEvents?.clusterStats?.length,
      });
    }

    if (intent.queryType === "request_logs") {
      const answer = formatRequestLogAnswer(query, combinedSnapshot.requestLogs);
      console.info(`[api/query:${queryId}] complete deterministic request_logs`, {
        elapsedMs: Date.now() - startedAt,
        answerLength: answer.length,
      });
      return done(NextResponse.json({
        query,
        intent,
        answer,
        resources: [],
        fetchedAt: gcpSnapshot?.fetchedAt || awsSnapshot?.fetchedAt || new Date().toISOString(),
      }));
    }

    if (gcpSnapshot && shouldFetchGkeEntryPoints(query, intent)) {
      console.info(`[api/query:${queryId}] gke entrypoint context start`, { elapsedMs: Date.now() - startedAt });
      combinedSnapshot.gkeEntryPoints = await buildGkeEntryPointContext({
        email,
        accessToken: session.accessToken,
        gcpSnapshot,
        isGcpMock,
        intent,
      });
      console.info(`[api/query:${queryId}] gke entrypoint context complete`, {
        elapsedMs: Date.now() - startedAt,
        available: combinedSnapshot.gkeEntryPoints?.available,
        totalEntryPoints: combinedSnapshot.gkeEntryPoints?.totalEntryPoints,
      });
    }

    console.info(`[api/query:${queryId}] answer generation start`, { elapsedMs: Date.now() - startedAt });
    const aiError = await resolveAiOrResponse();
    if (aiError) return done(aiError);
    const [answer, resources] = await Promise.all([
      generateAnswer(query, intent, combinedSnapshot, provider!, apiKey!),
      Promise.resolve(extractResources(intent, { gcp: gcpSnapshot, aws: awsSnapshot })),
    ]);
    console.info(`[api/query:${queryId}] complete`, {
      elapsedMs: Date.now() - startedAt,
      resourceCount: resources.length,
    });

    return done(NextResponse.json({
      query,
      intent,
      answer,
      resources,
      fetchedAt: gcpSnapshot?.fetchedAt || awsSnapshot?.fetchedAt
    }));
  } catch (err) {
    console.error(`[api/query:${queryId}] error`, {
      elapsedMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return done(NextResponse.json({ error: "Failed to process query. Check server logs." }, { status: 500 }));
  }
}
