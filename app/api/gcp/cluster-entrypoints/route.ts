import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { useMockData, initGoogleAuthForRequest } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";
import { getClusterEntryPoints } from "@/lib/gcp/cluster-entrypoints";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import type { GkeCluster } from "@/lib/gcp/types";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (useMockData() || session.isDemoUser) {
    return NextResponse.json({
      entryPoints: [
        {
          clusterName: "accounting-k8s-cluster",
          projectId: "accounting_project",
          location: "us-central1",
          type: "ingress",
          ip: "34.120.45.67",
          k8sService: "watchmen/ledger-gateway",
          isPublic: true,
        },
        {
          clusterName: "frontend-cluster",
          projectId: "frontend_prod",
          location: "us-central1",
          type: "loadbalancer",
          ip: "35.244.11.22",
          k8sService: "prod/web-ingress",
          isPublic: true,
        },
        {
          clusterName: "prod-infra-cluster",
          projectId: "infra_core",
          location: "us-central1",
          type: "loadbalancer",
          ip: "34.132.88.10",
          k8sService: "watchmen/request-processor",
          isPublic: true,
        },
      ],
      clusterCount: 3,
    });
  }

  const email = session.user.email;
  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  const accessToken = session.accessToken;

  // Read clusters from the stored snapshot — no re-scan needed
  let clusters: GkeCluster[] = [];
  try {
    await ensureGcpSnapshotTable();
    const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${email}`;
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No snapshot found. Run a scan from the main dashboard first." },
        { status: 404 },
      );
    }
    clusters = (result.rows[0].snapshot as any)?.gkeClusters ?? [];
  } catch (err) {
    console.error("[api/gcp/cluster-entrypoints] db read error:", err);
    return NextResponse.json({ error: "Failed to read snapshot from database." }, { status: 500 });
  }

  if (clusters.length === 0) {
    return NextResponse.json({ entryPoints: [], message: "No GKE clusters found in last snapshot." });
  }

  // Init auth (once) then delegate to fetcher
  try {
    const authMode = initGoogleAuthForRequest({
      serviceAccountKey: gcpCreds?.serviceAccountKey as string | undefined,
      accessToken,
    });
    if (!authMode) {
      return NextResponse.json(
        { error: "No GCP credentials configured.", credentialsRequired: true },
        { status: 422 },
      );
    }

    const entryPoints = await getClusterEntryPoints(clusters);
    return NextResponse.json({ entryPoints, clusterCount: clusters.length });
  } catch (err) {
    console.error("[api/gcp/cluster-entrypoints]", err);
    return NextResponse.json({ error: "Failed to fetch cluster entry points." }, { status: 500 });
  }
}
