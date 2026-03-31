import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { computeAttackPaths } from "@/lib/gcp/attack-paths";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let snapshot;
    if (useMockData() || session.isDemoUser) {
      snapshot = await fetchGcpSnapshot({ forceMock: true });
    } else {
      await ensureGcpSnapshotTable();
      const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${session.user.email}`;
      if (result.rows.length > 0) snapshot = result.rows[0].snapshot;
    }

    if (!snapshot) {
      return NextResponse.json({ error: "No snapshot yet. Run a scan first." }, { status: 404 });
    }

    const paths = computeAttackPaths(snapshot);
    return NextResponse.json({ paths, fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[api/attack-paths] error:", err);
    return NextResponse.json({ error: "Failed to compute attack paths." }, { status: 500 });
  }
}
