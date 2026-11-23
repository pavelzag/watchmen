import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMockScanResults, type ImageScanResult } from "@/lib/container-scanning";
import {
  useMockData as useGcpMockData,
  getProjectIdsForOrg,
  initGoogleAuthForRequest,
  discoverUserProjectIds,
  getProjectIdFromServiceAccountKey,
  getGcpScanWarnings,
  resetGcpScanWarnings,
} from "@/lib/gcp/client";
import { useMockAwsData, getAwsRegions } from "@/lib/aws/client";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";
import { getUserCloudCredentials } from "@/lib/credentials";
import { ensureGcpSnapshotTable, sql } from "@/lib/db";

async function getSnapshotProjectIds(userEmail: string): Promise<string[]> {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    return [];
  }
  try {
    await ensureGcpSnapshotTable();
    const res = await sql`
      SELECT snapshot FROM user_snapshots WHERE user_email = ${userEmail} LIMIT 1
    `;
    const snapshot = res.rows[0]?.snapshot as { projects?: Array<{ projectId?: string }> } | undefined;
    return (snapshot?.projects ?? [])
      .map((p) => p.projectId ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveGcpContainerProjects(options: {
  email: string;
  authMode: "service_account_key" | "oauth_token" | "adc" | null;
  serviceAccountKey?: string;
  accessToken?: unknown;
}): Promise<string[]> {
  if (!options.authMode) return [];

  let projectIds = await getProjectIdsForOrg();
  if (projectIds.length > 0) return projectIds;

  if (options.authMode === "oauth_token" && typeof options.accessToken === "string" && options.accessToken) {
    projectIds = await discoverUserProjectIds(options.accessToken);
    if (projectIds.length > 0) return projectIds;
  }

  if (options.authMode === "service_account_key" && options.serviceAccountKey) {
    const saProjectId = getProjectIdFromServiceAccountKey(options.serviceAccountKey);
    if (saProjectId) return [saProjectId];
  }

  return getSnapshotProjectIds(options.email);
}

function sortScanResults(results: ImageScanResult[]): ImageScanResult[] {
  return [...results].sort((a, b) => {
    if (b.summary.critical !== a.summary.critical) return b.summary.critical - a.summary.critical;
    if (b.summary.high !== a.summary.high) return b.summary.high - a.summary.high;
    if (b.summary.medium !== a.summary.medium) return b.summary.medium - a.summary.medium;
    if (b.summary.low !== a.summary.low) return b.summary.low - a.summary.low;
    return b.vulnerabilities.length - a.vulnerabilities.length;
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email;
  const isGcpMock = useGcpMockData() || Boolean(session.isDemoUser);
  const isAwsMock = useMockAwsData() || Boolean(session.isDemoUser);

  // Full demo/mock mode
  if (isGcpMock && isAwsMock) {
    const results = sortScanResults(getMockScanResults());
    return NextResponse.json({
      results,
      warnings: [],
      gcpProjects: [],
      scannedAt: new Date().toISOString(),
    });
  }

  try {
    resetGcpScanWarnings();

    let gcpAuthMode: "service_account_key" | "oauth_token" | "adc" | null = null;
    let gcpProjectIds: string[] = [];

    if (!isGcpMock) {
      const gcpCreds = await getUserCloudCredentials(email, "gcp");
      const serviceAccountKey = gcpCreds?.serviceAccountKey as string | undefined;
      gcpAuthMode = initGoogleAuthForRequest({
        serviceAccountKey,
        accessToken: session.accessToken,
      });

      gcpProjectIds = await resolveGcpContainerProjects({
        email,
        authMode: gcpAuthMode,
        serviceAccountKey,
        accessToken: session.accessToken,
      });
    }

    const awsRegions = getAwsRegions();

    const gcpPromise = isGcpMock
      ? Promise.resolve(getMockScanResults().filter((r) => r.cloud === "gcp"))
      : gcpAuthMode && gcpProjectIds.length > 0
        ? Promise.all(gcpProjectIds.map((pid) => getGcpContainerVulnerabilities(pid))).then((lists) => lists.flat())
        : Promise.resolve([] as ImageScanResult[]);

    const awsPromise = isAwsMock
      ? Promise.resolve(getMockScanResults().filter((r) => r.cloud === "aws"))
      : Promise.all(awsRegions.map((region) => getAwsContainerVulnerabilities(region))).then((lists) => lists.flat());

    const [gcpResults, awsResults, ghcrResults, dockerHubResults] = await Promise.all([
      gcpPromise,
      awsPromise,
      getGhcrVulnerabilities(email),
      getDockerHubVulnerabilities(email),
    ]);

    const results = sortScanResults([
      ...gcpResults,
      ...awsResults,
      ...ghcrResults,
      ...dockerHubResults,
    ]);

    return NextResponse.json({
      results,
      warnings: getGcpScanWarnings(),
      gcpProjects: gcpProjectIds,
      gcpAuthConfigured: isGcpMock || gcpAuthMode !== null,
      scannedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[api/container-scan] Failed to fetch scannings:", err);
    return NextResponse.json(
      { error: "Failed to fetch container scan results. See logs for info." },
      { status: 500 }
    );
  }
}
