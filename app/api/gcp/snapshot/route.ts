import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";

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
    const snapshot = row.snapshot;

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
