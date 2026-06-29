import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRecentLiveTraceEvents, subscribeLiveTraceEvents } from "@/lib/live-trace-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_RECYCLE_MS = 25_000;

export async function GET(req: NextRequest) {
  const streamId = crypto.randomUUID().slice(0, 8);
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const recent = getRecentLiveTraceEvents(email);
      console.info(`[api/trace/live:${streamId}] stream open`, {
        email,
        recentEvents: recent.length,
      });
      send("ready", { ok: true, recycleMs: STREAM_RECYCLE_MS });
      recent.forEach((event) => {
        console.info(`[api/trace/live:${streamId}] replay trace`, {
          eventId: event.id,
          cloud: event.cloud,
          kind: event.kind,
          projectId: event.projectId,
          resourceName: event.resourceName,
          status: event.status,
        });
        send("trace", event);
      });

      const unsubscribe = subscribeLiveTraceEvents(email, (event) => {
        console.info(`[api/trace/live:${streamId}] send trace`, {
          eventId: event.id,
          cloud: event.cloud,
          kind: event.kind,
          projectId: event.projectId,
          resourceName: event.resourceName,
          status: event.status,
        });
        send("trace", event);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        console.info(`[api/trace/live:${streamId}] stream close`, { email });
        clearInterval(heartbeat);
        clearTimeout(recycle);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      const recycle = setTimeout(() => {
        console.info(`[api/trace/live:${streamId}] stream recycle`, {
          email,
          recycleMs: STREAM_RECYCLE_MS,
        });
        send("reconnect", { ok: true, reason: "stream_recycle", recycleMs: STREAM_RECYCLE_MS });
        close();
      }, STREAM_RECYCLE_MS);

      req.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
