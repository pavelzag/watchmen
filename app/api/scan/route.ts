import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { useMockData } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export async function POST(req: NextRequest) {
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

  // Demo user with browser-supplied credentials → real scan, no DB credential storage
  const body = await req.json().catch(() => ({}));
  const demoGcpKey = (body as { demoCredentials?: { gcp?: { serviceAccountKey?: string } } })
    ?.demoCredentials?.gcp?.serviceAccountKey;

  if (session.isDemoUser && demoGcpKey) {
    // Real scan with browser-only credentials — snapshot returned inline, never written to DB
    try {
      const snapshot = await fetchGcpSnapshot({ serviceAccountKey: demoGcpKey });
      return NextResponse.json({
        ok: true,
        snapshot: {
          ...snapshot,
          users: extractUsers(snapshot),
          serviceAccountEmails: extractServiceAccountEmails(snapshot),
          fetchedAt: snapshot.fetchedAt,
        },
      });
    } catch (err) {
      console.error("[api/scan] POST demo-real error:", err);
      return NextResponse.json({ error: "Scan failed with provided credentials." }, { status: 500 });
    }
  }

  // Mock mode: skip DB, return fixture data
  if (useMockData() || session.isDemoUser) {
    try {
      const snapshot = await fetchGcpSnapshot({ forceMock: true });
      return NextResponse.json({ ok: true, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/scan] POST mock error:", err);
      return NextResponse.json({ error: "Failed to load mock data." }, { status: 500 });
    }
  }

  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  if (!gcpCreds) {
    return NextResponse.json(
      {
        error: "No GCP credentials configured. Go to Settings → Cloud Credentials.",
        credentialsRequired: true,
      },
      { status: 422 }
    );
  }

  try {
    const snapshot = await fetchGcpSnapshot({ serviceAccountKey: gcpCreds.serviceAccountKey });

    await ensureGcpSnapshotTable();
    await sql`
      INSERT INTO user_snapshots (user_email, snapshot, fetched_at)
      VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
      ON CONFLICT (user_email) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            fetched_at = EXCLUDED.fetched_at
    `;

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

  // Demo user: always return mock — real snapshots are returned inline from POST and cached in sessionStorage
  if (session.isDemoUser) {
    try {
      const snapshot = await fetchGcpSnapshot({ forceMock: true });
      return NextResponse.json({
        snapshot: { ...snapshot, users: extractUsers(snapshot), serviceAccountEmails: extractServiceAccountEmails(snapshot) },
        fetchedAt: snapshot.fetchedAt,
      });
    } catch (err) {
      console.error("[api/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock data." }, { status: 500 });
    }
  }

  // Non-demo mock mode
  if (useMockData()) {
    try {
      const snapshot = await fetchGcpSnapshot({ forceMock: true });
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
    await ensureGcpSnapshotTable();
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
