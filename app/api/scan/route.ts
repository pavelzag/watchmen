import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";
import { sql } from "@/lib/db";
import { useMockData } from "@/lib/gcp/client";

export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  try {
    const snapshot = await fetchGcpSnapshot(
      session.accessToken ? { accessToken: session.accessToken } : undefined
    );

    if (!useMockData()) {
      await sql`
        INSERT INTO user_snapshots (user_email, snapshot, fetched_at)
        VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
        ON CONFLICT (user_email) DO UPDATE
          SET snapshot = EXCLUDED.snapshot,
              fetched_at = EXCLUDED.fetched_at
      `;
    }

    return NextResponse.json({ ok: true, fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[api/scan] POST error:", err);
    return NextResponse.json({ error: "Scan failed. Check server logs." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  // Mock mode: skip DB, return live data
  if (useMockData()) {
    try {
      const snapshot = await fetchGcpSnapshot();
      return NextResponse.json({
        snapshot: {
          ...snapshot,
          users: extractUsers(snapshot),
          serviceAccountEmails: extractServiceAccountEmails(snapshot),
        },
        fetchedAt: snapshot.fetchedAt,
      });
    } catch (err) {
      console.error("[api/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock data." }, { status: 500 });
    }
  }

  try {
    const result = await sql`
      SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ snapshot: null, fetchedAt: null });
    }

    const row = result.rows[0];
    const snapshot = row.snapshot;

    return NextResponse.json({
      snapshot: {
        ...snapshot,
        users: extractUsers(snapshot),
        serviceAccountEmails: extractServiceAccountEmails(snapshot),
      },
      fetchedAt: row.fetched_at,
    });
  } catch (err) {
    console.error("[api/scan] GET error:", err);
    return NextResponse.json({ error: "Failed to load snapshot." }, { status: 500 });
  }
}
