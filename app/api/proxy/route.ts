import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, method = "GET", headers: reqHeaders, body } = await req.json();
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

  try {
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...safeHeaders },
    };

    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);
    const timing = Date.now() - start;
    const responseText = await res.text();

    return NextResponse.json({
      ok: true,
      status: res.status,
      statusText: res.statusText,
      timing,
      body: responseText,
      headers: Object.fromEntries(res.headers.entries()),
    });
  } catch (err: any) {
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
