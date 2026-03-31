import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMockScanResults } from "@/lib/container-scanning";
import { useMockData as useGcpMockData, getProjectIdsForOrg } from "@/lib/gcp/client";
import { useMockAwsData, getAwsRegions } from "@/lib/aws/client";
import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import { getAwsContainerVulnerabilities } from "@/lib/aws/ecr-scanning";
import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getDockerHubVulnerabilities } from "@/lib/dockerhub/dockerhub-scanning";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Demo/mock mode
  if ((useGcpMockData() && useMockAwsData()) || session.isDemoUser) {
    const results = getMockScanResults();
    return NextResponse.json({ results, scannedAt: new Date().toISOString() });
  }

  // Real mode: fetch concurrently from GCP and AWS
  try {
    const gcpProjectIds = await getProjectIdsForOrg();
    const awsRegions = getAwsRegions();

    const gcpPromises = gcpProjectIds.map((pid) => getGcpContainerVulnerabilities(pid));
    const awsPromises = awsRegions.map((region) => getAwsContainerVulnerabilities(region));
    const ghcrPromise = getGhcrVulnerabilities(session.user.email);
    const dockerHubPromise = getDockerHubVulnerabilities(session.user.email);

    const [gcpResultsList, awsResultsList, ghcrResults, dockerHubResults] = await Promise.all([
      Promise.all(gcpPromises),
      Promise.all(awsPromises),
      ghcrPromise,
      dockerHubPromise,
    ]);

    const results = [
      ...gcpResultsList.flat(),
      ...awsResultsList.flat(),
      ...ghcrResults,
      ...dockerHubResults,
    ];

    // Sort by most vulnerable first (critical desc, high desc)
    results.sort((a, b) => {
      if (b.summary.critical !== a.summary.critical) return b.summary.critical - a.summary.critical;
      return b.summary.high - a.summary.high;
    });

    return NextResponse.json({
      results,
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
