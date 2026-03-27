import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { useMockData, initGoogleAuthFromKey, initUserAuth } from "@/lib/gcp/client";
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
    return NextResponse.json({ entryPoints: [] });
  }

  const email = session.user.email;
  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  const accessToken = session.accessToken;

  if (!gcpCreds && !accessToken) {
    return NextResponse.json(
      { error: "No GCP credentials configured.", credentialsRequired: true },
      { status: 422 },
    );
  }

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
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (accessToken) {
      initUserAuth(accessToken as string);
    }

    const entryPoints = await getClusterEntryPoints(clusters);
    return NextResponse.json({ entryPoints, clusterCount: clusters.length });
  } catch (err) {
    console.error("[api/gcp/cluster-entrypoints]", err);
    return NextResponse.json({ error: "Failed to fetch cluster entry points." }, { status: 500 });
  }
}
