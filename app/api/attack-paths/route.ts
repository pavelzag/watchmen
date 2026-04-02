import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { sql } from "@/lib/db";
import { computeAttackPaths } from "@/lib/gcp/attack-paths";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
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

export async function GET(req: NextRequest) {
  const scope = "api/attack-paths:GET";
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const streamRequested = req.nextUrl.searchParams.get("stream") === "true";

  const runAnalysis = async (onProgress?: (event: TaskProgressEvent) => void) => {
    let snapshot;
    debugLog(scope, "request received", {
      email,
      isDemoUser: session.isDemoUser,
      useMockData: useMockData(),
    });

    emitProgress(onProgress, {
      stage: "load_snapshot",
      message: "Loading source snapshot",
      percent: 10,
    });

    if (useMockData() || session.isDemoUser) {
      snapshot = await withDebugTiming(scope, "loadMockSnapshot", { email }, () =>
        fetchGcpSnapshot({ forceMock: true })
      );
    } else {
      const result = await withDebugTiming(scope, "loadSnapshotFromDb", { email }, () =>
        sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${email}`
      );
      if (result.rows.length > 0) snapshot = result.rows[0].snapshot;
    }

    if (!snapshot) {
      return { ok: false as const, error: "No snapshot yet. Run a scan first.", status: 404 };
    }

    emitProgress(onProgress, {
      stage: "compute_attack_paths",
      message: "Computing attack paths from the current snapshot",
      percent: 50,
      metadata: { snapshotId: snapshot.snapshotId },
    });

    const paths = await withDebugTiming(scope, "computeAttackPaths", {
      email,
      snapshotId: snapshot.snapshotId,
    }, async () => computeAttackPaths(snapshot));
    debugLog(scope, "computed paths", { count: paths.length, email });

    emitProgress(onProgress, {
      stage: "complete",
      message: `Computed ${paths.length} attack path${paths.length === 1 ? "" : "s"}`,
      percent: 100,
      metadata: { count: paths.length },
    });

    return { ok: true as const, paths, fetchedAt: snapshot.fetchedAt };
  };

  if (streamRequested) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => sendStreamEvent(controller, encoder, event);
        void (async () => {
          try {
            const result = await runAnalysis((progress) => send({ type: "progress", progress }));
            if (!result.ok) send({ type: "error", error: result.error });
            else send({ type: "result", ...result });
          } catch (err) {
            debugError(scope, "streamed attack path computation failed", err, { email });
            send({ type: "error", error: "Failed to compute attack paths." });
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
    const result = await runAnalysis();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ paths: result.paths, fetchedAt: result.fetchedAt });
  } catch (err) {
    debugError(scope, "attack path computation failed", err, { email });
    console.error("[api/attack-paths] error:", err);
    return NextResponse.json({ error: "Failed to compute attack paths." }, { status: 500 });
  }
}
