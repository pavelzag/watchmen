import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo-mode";
import {
  ensureLiveTraceBusListener,
  getRecentLiveTraceEventsAsync,
  subscribeLiveTraceEvents,
} from "@/lib/live-trace-bus";
import { getDemoLiveTraceEvents } from "@/lib/mock/runtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_RECYCLE_MS = 25_000;

export async function GET(req: NextRequest) {
  const streamId = crypto.randomUUID().slice(0, 8);
  const session = await auth();
  const email = session?.user?.email ?? "anonymous";

  await ensureLiveTraceBusListener();
  const isDemo = Boolean(session?.isDemoUser || isDemoMode());
  const busRecent = await getRecentLiveTraceEventsAsync(email);
  const recent = isDemo && busRecent.length === 0 ? getDemoLiveTraceEvents() : busRecent;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

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

      // Subscribe to own email plus global/anonymous fan-out so non-authorized port-forward traffic appears
      const unsubGlobal = subscribeLiveTraceEvents("global", (event) => {
        console.info(`[api/trace/live:${streamId}] send trace (global)`, {
          eventId: event.id,
          cloud: event.cloud,
          kind: event.kind,
          projectId: event.projectId,
          resourceName: event.resourceName,
          status: event.status,
        });
        send("trace", event);
      });
      const unsubAnon = email !== "anonymous" ? subscribeLiveTraceEvents("anonymous", (event) => {
        console.info(`[api/trace/live:${streamId}] send trace (anonymous)`, {
          eventId: event.id,
          cloud: event.cloud,
          kind: event.kind,
          projectId: event.projectId,
          resourceName: event.resourceName,
          status: event.status,
        });
        send("trace", event);
      }) : () => {};

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

      let demoIndex = 0;
      const demoStreamTimer = isDemo
        ? setInterval(() => {
            if (closed) return;
            const samples = getDemoLiveTraceEvents();
            const sample = samples[demoIndex % samples.length];
            demoIndex += 1;
            send("trace", {
              ...sample,
              id: `demo-live-stream-${Date.now()}-${demoIndex}`,
              timestamp: new Date().toISOString(),
            });
          }, 3_500)
        : null;

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        console.info(`[api/trace/live:${streamId}] stream close`, { email });
        clearInterval(heartbeat);
        if (demoStreamTimer) clearInterval(demoStreamTimer);
        clearTimeout(recycle);
        unsubscribe();
        unsubGlobal();
        unsubAnon();
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
