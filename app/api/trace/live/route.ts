import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRecentLiveTraceEvents, subscribeLiveTraceEvents } from "@/lib/live-trace-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      send("ready", { ok: true });
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

      const close = () => {
        console.info(`[api/trace/live:${streamId}] stream close`, { email });
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

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
