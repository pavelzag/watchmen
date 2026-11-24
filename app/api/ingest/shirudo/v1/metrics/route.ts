import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { parseOtlpHttpJsonBody } from "@/lib/shirudo/http";
import { ingestShirudoOtlpMetrics } from "@/lib/shirudo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser) {
    return NextResponse.json({ error: "OTLP ingestion is disabled in Demo mode." }, { status: 403 });
  }

  try {
    const body = await parseOtlpHttpJsonBody(req);
    const result = await ingestShirudoOtlpMetrics({
      userEmail: actor.email,
      body,
    });

    return NextResponse.json({
      partialSuccess: {},
      watchmen: result,
    });
  } catch (err) {
    console.error("[api/ingest/shirudo/v1/metrics] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to ingest Shirudo OTLP metrics." },
      { status: 400 }
    );
  }
}
