import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { fetchAwsSnapshot } from "@/lib/aws"; // Integrated AWS
import { useMockData } from "@/lib/gcp/client";
import { useMockAwsData } from "@/lib/aws/client"; // Integrated AWS
import { extractIntent, generateAnswer, extractResources } from "@/lib/claude/query-processor";
import { callAI, resolveAI, type AIProvider } from "@/lib/ai/client";
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable } from "@/lib/db"; // Added AWS table ensure
import { getGcpAuthFailures } from "@/lib/gcp/auth-failures";
import { getAwsAuthFailures } from "@/lib/aws/auth-failures";
import { getMockScanResults } from "@/lib/container-scanning";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";
import { getAwsRegions } from "@/lib/aws/client";

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

    // GCP Snapshot fetch
    if (useMockData() || session.isDemoUser) {
      gcpSnapshot = await fetchGcpSnapshot({ forceMock: true });
    } else {
      await ensureGcpSnapshotTable();
      const result = await sql`
        SELECT snapshot FROM user_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length > 0) {
        gcpSnapshot = result.rows[0].snapshot;
      }
    }

    // AWS Snapshot fetch
    if (useMockAwsData() || session.isDemoUser) {
      awsSnapshot = await fetchAwsSnapshot({ forceMock: true });
    } else {
      await ensureAwsSnapshotTable();
      const result = await sql`
        SELECT snapshot FROM aws_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length > 0) {
        awsSnapshot = result.rows[0].snapshot;
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

    if (!gcpSnapshot && !awsSnapshot) {
      return NextResponse.json(
        { error: "No snapshots yet. Please wait for the initial scan." },
        { status: 404 }
      );
    }

    const intent = await extractIntent(query, provider, apiKey);
    const combinedSnapshot: any = { gcp: gcpSnapshot, aws: awsSnapshot };
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
