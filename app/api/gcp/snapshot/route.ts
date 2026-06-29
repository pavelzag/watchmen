import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";
import { initGoogleAuthFromKey, useMockData } from "@/lib/gcp/client";
import { getGkeClusters } from "@/lib/gcp/gke";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { getUserCloudCredentials } from "@/lib/credentials";
import type { GcpSnapshot } from "@/lib/gcp/types";

async function refreshLiveGkeClusters(
  email: string,
  snapshot: GcpSnapshot,
): Promise<GcpSnapshot> {
  const projectIds = [
    ...new Set([
      ...(snapshot.projects ?? []).map((project) => project.projectId),
      ...(snapshot.gkeClusters ?? []).map((cluster) => cluster.projectId),
    ].filter(Boolean)),
  ];
  if (projectIds.length === 0) return snapshot;

  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  if (gcpCreds?.serviceAccountKey) {
    initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
  } else {
    return snapshot;
  }

  try {
    const gkeClusters = await getGkeClusters(projectIds, false);
    return { ...snapshot, gkeClusters };
  } catch (err) {
    console.warn("[api/gcp/snapshot] live GKE refresh failed; using stored snapshot", err);
    return snapshot;
  }
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mock mode: Return live mock data
  if (useMockData() || session.isDemoUser) {
    try {
      const snapshot = await fetchGcpSnapshot({ forceMock: true });
      return NextResponse.json({
        ...snapshot,
        users: extractUsers(snapshot),
        serviceAccountEmails: extractServiceAccountEmails(snapshot),
      });
    } catch (err) {
      console.error("[api/gcp/snapshot] mock error:", err);
      return NextResponse.json({ error: "Failed to fetch GCP data." }, { status: 500 });
    }
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  try {
    await ensureGcpSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No snapshot found. A scan will start shortly." },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    const snapshot = await refreshLiveGkeClusters(email, row.snapshot as GcpSnapshot);

    return NextResponse.json({
      ...snapshot,
      users: extractUsers(snapshot),
      serviceAccountEmails: extractServiceAccountEmails(snapshot),
      fetchedAt: row.fetched_at,
    });
  } catch (err) {
    console.error("[api/gcp/snapshot] error:", err);
    return NextResponse.json({ error: "Failed to fetch GCP data." }, { status: 500 });
  }
}
