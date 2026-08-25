import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    console.info("[runtime-security/globe-debug]", {
      ts: new Date().toISOString(),
      status: body.status,
      webgl: body.webgl,
      width: body.width,
      height: body.height,
      frameCount: body.frameCount,
      markerCount: body.markerCount,
      visibleMarkerCount: body.visibleMarkerCount,
      countries: body.countries,
      cities: body.cities,
      error: body.error,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[runtime-security/globe-debug] failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
