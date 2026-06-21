import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { publishLiveTraceEvent, type LiveTraceIngressEvent } from "@/lib/live-trace-bus";

// Blocked headers — never forward credentials or host overrides to upstream.
const BLOCKED_HEADERS = new Set(["authorization", "cookie", "host", "x-forwarded-for", "x-real-ip"]);

function isBlockedUrl(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return true; }
  if (parsed.protocol !== "https:") return true;
  const h = parsed.hostname.toLowerCase();
  // Metadata endpoints
  if (h === "169.254.169.254" || h === "metadata.google.internal" || h === "metadata.internal") return true;
  // Loopback / link-local
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  // RFC-1918 private ranges
  if (/^10\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!session?.user || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, method = "GET", headers: reqHeaders, body, traceTarget } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  if (isBlockedUrl(url)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
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

  const publishTraceEvent = (status?: number, latencyMs?: number) => {
    if (!traceTarget || typeof traceTarget !== "object") return;
    const target = traceTarget as Partial<LiveTraceIngressEvent>;
    if (
      (target.cloud !== "gcp" && target.cloud !== "aws") ||
      (target.kind !== "cloudrun" && target.kind !== "vm" && target.kind !== "gke") ||
      !target.projectId ||
      !target.resourceName
    ) {
      return;
    }

    let path = "/";
    try {
      path = new URL(url).pathname || "/";
    } catch {}

    publishLiveTraceEvent(email, {
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
    });
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
