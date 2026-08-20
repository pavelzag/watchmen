import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { publishLiveTraceEvent, type LiveTraceIngressEvent } from "@/lib/live-trace-bus";

// Blocked headers — never forward credentials or host overrides to upstream.
const BLOCKED_HEADERS = new Set(["authorization", "cookie", "host", "x-forwarded-for", "x-real-ip"]);

function isLocalTargetAllowed(traceTarget: unknown): boolean {
  return (
    typeof traceTarget === "object" &&
    traceTarget !== null &&
    (traceTarget as { cloud?: unknown }).cloud === "kubernetes" &&
    (process.env.NODE_ENV !== "production" || process.env.WATCHMEN_ALLOW_LOCAL_TARGETS === "true")
  );
}

function getBlockedUrlReason(rawUrl: string, traceTarget: unknown): string | null {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return "Invalid URL"; }
  const allowLocal = isLocalTargetAllowed(traceTarget);
  if (parsed.protocol !== "https:" && !(allowLocal && parsed.protocol === "http:")) return "Only HTTPS URLs are allowed.";
  const h = parsed.hostname.toLowerCase();
  // Metadata endpoints
  if (h === "169.254.169.254" || h === "metadata.google.internal" || h === "metadata.internal") return "Metadata endpoints are blocked.";
  // Loopback / link-local
  if (!allowLocal && (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0")) return "Localhost targets are blocked.";
  // RFC-1918 private ranges
  if (!allowLocal && /^10\./.test(h)) return "Private-network targets are blocked.";
  if (!allowLocal && /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return "Private-network targets are blocked.";
  if (!allowLocal && /^192\.168\./.test(h)) return "Private-network targets are blocked.";
  if (allowLocal && process.env.NODE_ENV === "production" && process.env.WATCHMEN_ALLOW_LOCAL_TARGETS !== "true") {
    return "Local Kubernetes target proxying requires WATCHMEN_ALLOW_LOCAL_TARGETS=true in production.";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const session = await auth();
  // Allow anonymous (non-logged-in) requests to be traced as well - fan-out via global bus
  const email = session?.user?.email ?? "anonymous";

  const { url, method = "GET", headers: reqHeaders, body, traceTarget } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const blockedReason = getBlockedUrlReason(url, traceTarget);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 400 });
  }

  // Strip blocked headers from caller-supplied headers
  const safeHeaders: Record<string, string> = {};
  if (reqHeaders && typeof reqHeaders === "object") {
    for (const [k, v] of Object.entries(reqHeaders)) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
        safeHeaders[k] = String(v);
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const start = Date.now();
  const requestMethod = method.toUpperCase();
  let hostname = "<invalid>";
  try {
    hostname = new URL(url).hostname;
  } catch {}

  console.info(`[api/proxy:${requestId}] request start`, {
    email,
    method: requestMethod,
    hostname,
    hasTraceTarget: Boolean(traceTarget),
    traceTarget,
  });

  const publishTraceEvent = (status?: number, latencyMs?: number) => {
    if (!traceTarget || typeof traceTarget !== "object") {
      console.info(`[api/proxy:${requestId}] live trace publish skipped`, {
        reason: "missing_trace_target",
        status,
        latencyMs,
      });
      return;
    }
    const target = traceTarget as Partial<LiveTraceIngressEvent>;
    if (
      (target.cloud !== "gcp" && target.cloud !== "aws" && target.cloud !== "kubernetes") ||
      (target.kind !== "cloudrun" && target.kind !== "vm" && target.kind !== "gke") ||
      !target.projectId ||
      !target.resourceName
    ) {
      console.info(`[api/proxy:${requestId}] live trace publish skipped`, {
        reason: "invalid_trace_target",
        status,
        latencyMs,
        traceTarget,
      });
      return;
    }

    let path = "/";
    try {
      path = new URL(url).pathname || "/";
    } catch {}

    const event: LiveTraceIngressEvent = {
      id: `proxy:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      cloud: target.cloud,
      kind: target.kind,
      projectId: target.projectId,
      region: typeof target.region === "string" ? target.region : undefined,
      resourceName: target.resourceName,
      container: typeof target.container === "string" ? target.container : undefined,
      timestamp: new Date().toISOString(),
      method: requestMethod,
      path,
      status,
      latency: typeof latencyMs === "number" ? `${latencyMs}ms` : undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
      count: 1,
    };
    console.info(`[api/proxy:${requestId}] live trace publish`, {
      eventId: event.id,
      cloud: event.cloud,
      kind: event.kind,
      projectId: event.projectId,
      resourceName: event.resourceName,
      status: event.status,
      path: event.path,
      latency: event.latency,
    });
    publishLiveTraceEvent(email, event);
  };

  try {
    const fetchOptions: RequestInit = {
      method: requestMethod,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...safeHeaders },
    };

    if (body !== undefined && requestMethod !== "GET" && requestMethod !== "HEAD") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);
    const timing = Date.now() - start;
    const responseText = await res.text();
    console.info(`[api/proxy:${requestId}] upstream complete`, {
      hostname,
      status: res.status,
      timing,
      bodyBytes: responseText.length,
    });
    publishTraceEvent(res.status, timing);

    return NextResponse.json({
      ok: true,
      status: res.status,
      statusText: res.statusText,
      timing,
      body: responseText,
      headers: Object.fromEntries(res.headers.entries()),
    });
  } catch (err: any) {
    console.error(`[api/proxy:${requestId}] upstream failed`, {
      hostname,
      error: err?.message ?? String(err),
      name: err?.name,
      timing: Date.now() - start,
    });
    publishTraceEvent(undefined, Date.now() - start);
    return NextResponse.json(
      {
        ok: false,
        error: err.name === "AbortError" ? "Request timed out (15s)" : (err.message ?? "Request failed"),
        timing: Date.now() - start,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
