import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMockScanResults, type ImageScanResult } from "@/lib/container-scanning";
import {
  useMockData as useGcpMockData,
  getGcpScanWarnings,
  resetGcpScanWarnings,
} from "@/lib/gcp/client";
import { useMockAwsData, getAwsRegions } from "@/lib/aws/client";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { resolveGcpContainerScanContext } from "@/lib/gcp/container-scan-auth";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";
import { mergeCachedTrivyScans } from "@/lib/container-scan-cache";
import { isTrivyAvailable } from "@/lib/trivy/scanner";

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
      gcpAuthConfigured: true,
      trivyAvailable: false,
      scannedAt: new Date().toISOString(),
    });
  }

  try {
    resetGcpScanWarnings();

    let gcpAuthMode: "service_account_key" | "oauth_token" | "adc" | null = null;
    let gcpProjectIds: string[] = [];

    if (!isGcpMock) {
      const ctx = await resolveGcpContainerScanContext({
        email,
        accessToken: session.accessToken,
      });
      gcpAuthMode = ctx.authMode;
      gcpProjectIds = ctx.projectIds;
    }

    const awsRegions = getAwsRegions();
    const trivyAvailable = !isGcpMock ? await isTrivyAvailable() : false;
    const skipContainerAnalysis =
      trivyAvailable && process.env.GCP_ENABLE_CONTAINER_ANALYSIS !== "true";

    const gcpPromise = isGcpMock
      ? Promise.resolve(getMockScanResults().filter((r) => r.cloud === "gcp"))
      : gcpAuthMode && gcpProjectIds.length > 0
        ? Promise.all(
            gcpProjectIds.map((pid) =>
              skipContainerAnalysis
                ? getGcpContainerVulnerabilities(pid, { skipContainerAnalysis: true })
                : getGcpContainerVulnerabilities(pid)
            )
          ).then((lists) => mergeCachedTrivyScans(lists.flat()))
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

    const warnings = getGcpScanWarnings().filter(
      (w) =>
        !(
          trivyAvailable &&
          w.service === "containeranalysis" &&
          (w.code === "permission_denied" || w.code === "api_not_enabled")
        )
    );

    return NextResponse.json({
      results,
      warnings,
      gcpProjects: gcpProjectIds,
      gcpAuthConfigured: isGcpMock || gcpAuthMode !== null,
      trivyAvailable,
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
