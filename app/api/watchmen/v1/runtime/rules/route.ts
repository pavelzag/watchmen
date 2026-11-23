import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { KNOWN_ATTACK_VECTORS } from "@/lib/runtime-security";
import {
  createRuntimeSecurityRule,
  getRuntimeSecurityRules,
} from "@/lib/runtime-security-store";
import {
  isRuntimeSecurityAction,
  isRuntimeSecurityRuleMode,
  isRuntimeSecuritySeverity,
  parseRuntimeRuleCondition,
} from "@/lib/runtime-security-validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await getRuntimeSecurityRules(actor.email);
  return NextResponse.json({
    rules,
    attackVectors: KNOWN_ATTACK_VECTORS,
  });
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Rule name is required." }, { status: 400 });
  }

  const action = body.action;
  if (!isRuntimeSecurityAction(action)) {
    return NextResponse.json(
      { error: "Action must be alert, block, flag, or would_block." },
      { status: 400 },
    );
  }

  const mode = body.mode ?? "detect";
  if (!isRuntimeSecurityRuleMode(mode)) {
    return NextResponse.json({ error: "Mode must be detect or enforce." }, { status: 400 });
  }

  const severity = body.severity;
  if (!isRuntimeSecuritySeverity(severity)) {
    return NextResponse.json(
      { error: "Severity must be low, medium, high, or critical." },
      { status: 400 },
    );
  }

  const condition = parseRuntimeRuleCondition(body.condition);
  if (!condition) {
    return NextResponse.json({ error: "Condition is invalid." }, { status: 400 });
  }

  const rule = await createRuntimeSecurityRule(actor.email, {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined,
    name,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    action,
    mode,
    condition,
    severity,
    description: typeof body.description === "string" ? body.description : "",
  });

  return NextResponse.json({ rule }, { status: 201 });
}
