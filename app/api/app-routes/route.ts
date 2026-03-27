/**
 * Probes a discovered entry-point URL for well-known route introspection endpoints.
 * Tries /routes (wm-echo native), /openapi.json, /swagger.json, /api-docs in order.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PROBE_PATHS = [
  "/routes",
  "/openapi.json",
  "/swagger.json",
  "/api-docs",
  "/.well-known/openapi.json",
];

interface DiscoveredRoute {
  method: string;
  path: string;
  description?: string;
  body?: unknown;
}

async function probeUrl(base: string, path: string): Promise<DiscoveredRoute[] | null> {
  try {
    const url = base.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;

    const data = await res.json();

    // wm-echo /routes format: { routes: [{method, path, description, body}] }
    if (Array.isArray(data.routes)) return data.routes as DiscoveredRoute[];

    // OpenAPI 3.x: { paths: { "/foo": { get: {summary}, post: {summary} } } }
    if (data.openapi && data.paths) {
      const routes: DiscoveredRoute[] = [];
      for (const [p, methods] of Object.entries(data.paths as Record<string, any>)) {
        for (const [method, op] of Object.entries(methods as Record<string, any>)) {
          if (["get","post","put","patch","delete"].includes(method)) {
            routes.push({ method: method.toUpperCase(), path: p, description: op?.summary ?? op?.description });
          }
        }
      }
      return routes;
    }

    // Swagger 2.x: same paths structure but with "swagger" key
    if (data.swagger && data.paths) {
      const routes: DiscoveredRoute[] = [];
      for (const [p, methods] of Object.entries(data.paths as Record<string, any>)) {
        for (const [method, op] of Object.entries(methods as Record<string, any>)) {
          if (["get","post","put","patch","delete"].includes(method)) {
            routes.push({ method: method.toUpperCase(), path: p, description: op?.summary ?? op?.description });
          }
        }
      }
      return routes;
    }
  } catch { /* timeout or network error */ }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const baseUrl = searchParams.get("url");
  if (!baseUrl) return NextResponse.json({ error: "url is required" }, { status: 400 });

  for (const path of PROBE_PATHS) {
    const routes = await probeUrl(baseUrl, path);
    if (routes && routes.length > 0) {
      return NextResponse.json({ routes, discoveredFrom: path });
    }
  }

  return NextResponse.json({ routes: [], discoveredFrom: null });
}
