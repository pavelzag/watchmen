import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import {
  getRuntimeRequestEventById,
  getRuntimeSecurityRules,
} from "@/lib/runtime-security-store";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const [event, rules] = await Promise.all([
    getRuntimeRequestEventById(actor.email, id),
    getRuntimeSecurityRules(actor.email),
  ]);

  if (!event) {
    return NextResponse.json({ error: "Runtime request event not found." }, { status: 404 });
  }

  const matchedRules = rules.filter((r) => event.matchedRuleIds.includes(r.id));
  return NextResponse.json({ event, matchedRules });
}
