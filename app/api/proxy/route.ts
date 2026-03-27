import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, method = "GET", headers: reqHeaders, body } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const start = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(reqHeaders ?? {}) },
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
