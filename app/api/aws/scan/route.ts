import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { sql, ensureAwsSnapshotTable } from "@/lib/db";
import { useMockAwsData } from "@/lib/aws/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  // Demo user with browser-supplied credentials → real scan, no DB credential storage
  const body = await req.json().catch(() => ({}));
  type DemoBody = { demoCredentials?: { aws?: { accessKeyId?: string; secretAccessKey?: string; region?: string } } };
  const demoCreds = (body as DemoBody)?.demoCredentials?.aws;

  if (session.isDemoUser && demoCreds?.accessKeyId && demoCreds?.secretAccessKey) {
    try {
      const snapshot = await fetchAwsSnapshot({
        accessKeyId: demoCreds.accessKeyId,
        secretAccessKey: demoCreds.secretAccessKey,
        region: demoCreds.region,
      });
      await ensureAwsSnapshotTable();
      await sql`
        INSERT INTO aws_snapshots (user_email, snapshot, fetched_at)
        VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
        ON CONFLICT (user_email) DO UPDATE
          SET snapshot = EXCLUDED.snapshot,
              fetched_at = EXCLUDED.fetched_at
      `;
      return NextResponse.json({ ok: true, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] POST demo-real error:", err);
      return NextResponse.json({ error: "AWS scan failed with provided credentials." }, { status: 500 });
    }
  }

  // Mock mode: return fixture data
  if (useMockAwsData() || session.isDemoUser) {
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      return NextResponse.json({ ok: true, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] POST mock error:", err);
      return NextResponse.json({ error: "Failed to load mock AWS data." }, { status: 500 });
    }
  }

  const awsCreds = await getUserCloudCredentials(email, "aws");
  if (!awsCreds) {
    return NextResponse.json(
      {
        error: "No AWS credentials configured. Go to Settings → Cloud Credentials.",
        credentialsRequired: true,
      },
      { status: 422 }
    );
  }

  try {
    const snapshot = await fetchAwsSnapshot({
      accessKeyId: awsCreds.accessKeyId,
      secretAccessKey: awsCreds.secretAccessKey,
      region: awsCreds.region,
    });

    await ensureAwsSnapshotTable();
    await sql`
      INSERT INTO aws_snapshots (user_email, snapshot, fetched_at)
      VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
      ON CONFLICT (user_email) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            fetched_at = EXCLUDED.fetched_at
    `;

    return NextResponse.json({ ok: true, fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[api/aws/scan] POST error:", err);
    return NextResponse.json({ error: "AWS scan failed. Check server logs." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  // Demo user: prefer real DB snapshot, else mock
  if (session.isDemoUser) {
    try {
      await ensureAwsSnapshotTable();
      const result = await sql`SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}`;
      if (result.rows.length > 0) {
        return NextResponse.json({ snapshot: result.rows[0].snapshot, fetchedAt: result.rows[0].fetched_at });
      }
    } catch { /* fall through to mock */ }
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      return NextResponse.json({ snapshot, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock AWS data." }, { status: 500 });
    }
  }

  if (useMockAwsData()) {
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      return NextResponse.json({ snapshot, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock AWS data." }, { status: 500 });
    }
  }

  try {
    await ensureAwsSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ snapshot: null, fetchedAt: null });
    }

    const row = result.rows[0];
    return NextResponse.json({ snapshot: row.snapshot, fetchedAt: row.fetched_at });
  } catch (err) {
    console.error("[api/aws/scan] GET error:", err);
    return NextResponse.json({ error: "Failed to load AWS snapshot." }, { status: 500 });
  }
}
