import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { getRuntimeSecuritySummary } from "@/lib/runtime-security-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const summary = await getRuntimeSecuritySummary(actor.email, {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  return NextResponse.json(summary);
}
