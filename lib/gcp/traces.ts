import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { CloudTrace, TraceSpan } from "./types";

async function getMockTraces(): Promise<CloudTrace[]> {
  const data = await import("@/fixtures/traces.json");
  return data.default as CloudTrace[];
}

function resolveAttr(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const val = v as Record<string, unknown>;
  if (val.stringValue && typeof val.stringValue === "object") {
    return (val.stringValue as Record<string, unknown>).value as string | undefined;
  }
  if (val.intValue !== undefined) return String(val.intValue);
  if (val.boolValue !== undefined) return String(val.boolValue);
  return undefined;
}

async function getRealTraces(projectIds: string[]): Promise<CloudTrace[]> {
  initGoogleAuth();
  const tracer = google.cloudtrace("v2");
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const results = await Promise.allSettled(
    projectIds.map(async (projectId): Promise<CloudTrace[]> => {
      const res = await (tracer.projects.traces as any).list({
        parent: `projects/${projectId}`,
        pageSize: 100,
        orderBy: "start_time desc",
        startTime: oneHourAgo,
      });

      const traces: CloudTrace[] = [];
      for (const t of res.data.traces ?? []) {
        const traceId = (t.name ?? "").split("/").pop() ?? "";
        const startMs = t.startTime ? new Date(t.startTime).getTime() : 0;
        const endMs = t.endTime ? new Date(t.endTime).getTime() : startMs;

        const spans: TraceSpan[] = (t.spans ?? []).map((s: Record<string, unknown>): TraceSpan => {
          const spanStart = s.startTime ? new Date(s.startTime as string).getTime() : 0;
          const spanEnd = s.endTime ? new Date(s.endTime as string).getTime() : spanStart;

          const attrMap = ((s.attributes as Record<string, unknown>)?.attributeMap ?? {}) as Record<string, unknown>;
          const attrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(attrMap)) {
            const resolved = resolveAttr(v);
            if (resolved !== undefined) attrs[k] = resolved;
          }

          const displayName =
            ((s.displayName as Record<string, unknown>)?.value as string) ?? (s.spanId as string) ?? "";

          return {
            spanId: (s.spanId as string) ?? "",
            parentSpanId: (s.parentSpanId as string) || undefined,
            displayName,
            startTime: (s.startTime as string) ?? "",
            endTime: (s.endTime as string) ?? "",
            durationMs: Math.max(0, spanEnd - spanStart),
            httpMethod: attrs["http.method"],
            httpStatusCode: attrs["http.status_code"] ? parseInt(attrs["http.status_code"]) : undefined,
            attributes: attrs,
          };
        });

        const rootSpan = spans.find((s) => !s.parentSpanId);
        const displayName = (t.displayName as Record<string, unknown>)?.value as string ?? traceId;

        traces.push({
          traceId,
          projectId,
          displayName,
          startTime: (t.startTime as string) ?? "",
          endTime: (t.endTime as string) ?? "",
          durationMs: Math.max(0, endMs - startMs),
          httpMethod: rootSpan?.httpMethod,
          httpUrl:
            rootSpan?.attributes?.["http.url"] ??
            rootSpan?.attributes?.["http.target"] ??
            rootSpan?.attributes?.["http.path"],
          httpStatusCode: rootSpan?.httpStatusCode,
          spans,
        });
      }

      return traces;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<CloudTrace[]> => {
      if (r.status === "rejected") logFetchWarning("cloudtrace", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

export async function getCloudTraces(
  projectIds: string[],
  forceMock?: boolean
): Promise<CloudTrace[]> {
  if (useMockData(forceMock)) return getMockTraces();
  return getRealTraces(projectIds);
}
