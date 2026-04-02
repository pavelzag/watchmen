import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { sql, ensureAwsSnapshotTable } from "@/lib/db";
import { useMockAwsData } from "@/lib/aws/client";
import { getUserCloudCredentials } from "@/lib/credentials";
import type { TaskProgressEvent } from "@/lib/tasks/types";

function sendStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: unknown
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function emitProgress(
  onProgress: ((event: TaskProgressEvent) => void) | undefined,
  event: TaskProgressEvent
) {
  onProgress?.(event);
}

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
  const body = await req.json().catch(() => ({})) as {
    stream?: boolean;
    demoCredentials?: { aws?: { accessKeyId?: string; secretAccessKey?: string; region?: string } };
  };
  const demoCreds = body?.demoCredentials?.aws;

  const runScan = async (onProgress?: (event: TaskProgressEvent) => void) => {
    if (session.isDemoUser && demoCreds?.accessKeyId && demoCreds?.secretAccessKey) {
      emitProgress(onProgress, {
        stage: "start",
        message: "Starting AWS scan with supplied demo credentials",
        percent: 0,
      });
      const snapshot = await fetchAwsSnapshot({
        accessKeyId: demoCreds.accessKeyId,
        secretAccessKey: demoCreds.secretAccessKey,
        region: demoCreds.region,
        onProgress,
      });
      return { ok: true as const, snapshot, fetchedAt: snapshot.fetchedAt };
    }

    if (useMockAwsData() || session.isDemoUser) {
      emitProgress(onProgress, {
        stage: "start",
        message: "Starting mock AWS scan",
        percent: 0,
      });
      const snapshot = await fetchAwsSnapshot({ forceMock: true, onProgress });
      return { ok: true as const, fetchedAt: snapshot.fetchedAt };
    }

    const awsCreds = await getUserCloudCredentials(email, "aws");
    if (!awsCreds) {
      return {
        ok: false as const,
        error: "No AWS credentials configured. Go to Settings → Cloud Credentials.",
        credentialsRequired: true,
        status: 422,
      };
    }

    emitProgress(onProgress, {
      stage: "start",
      message: "Starting live AWS scan",
      percent: 0,
      metadata: { region: awsCreds.region ?? "default" },
    });

    const snapshot = await fetchAwsSnapshot({
      accessKeyId: awsCreds.accessKeyId,
      secretAccessKey: awsCreds.secretAccessKey,
      region: awsCreds.region,
      onProgress,
    });

    emitProgress(onProgress, {
      stage: "persist_snapshot",
      message: "Persisting AWS snapshot",
      percent: 97,
      metadata: { snapshotId: snapshot.snapshotId },
    });

    await ensureAwsSnapshotTable();
    await sql`
      INSERT INTO aws_snapshots (user_email, snapshot, fetched_at)
      VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
      ON CONFLICT (user_email) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            fetched_at = EXCLUDED.fetched_at
    `;

    return { ok: true as const, fetchedAt: snapshot.fetchedAt };
  };

  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => sendStreamEvent(controller, encoder, event);
        void (async () => {
          try {
            const result = await runScan((progress) => send({ type: "progress", progress }));
            if (!result.ok) send({ type: "error", error: result.error, credentialsRequired: result.credentialsRequired });
            else send({ type: "result", ...result });
          } catch (err) {
            console.error("[api/aws/scan] streamed POST error:", err);
            send({ type: "error", error: "AWS scan failed. Check server logs." });
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  try {
    const result = await runScan();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, credentialsRequired: result.credentialsRequired },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
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

  // Demo user: always return mock — real snapshots are returned inline from POST and cached in sessionStorage
  if (session.isDemoUser) {
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
