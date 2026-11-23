import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import type { RuntimeSecurityRule } from "@/lib/runtime-security";
import {
  deleteRuntimeSecurityRule,
  getRuntimeSecurityRule,
  updateRuntimeSecurityRule,
} from "@/lib/runtime-security-store";
import {
  isRuntimeSecurityAction,
  isRuntimeSecurityRuleMode,
  isRuntimeSecuritySeverity,
  parseRuntimeRuleCondition,
} from "@/lib/runtime-security-validation";

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
  const rule = await getRuntimeSecurityRule(actor.email, id);
  if (!rule) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({ rule });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<RuntimeSecurityRule> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Rule name cannot be empty." }, { status: 400 });
    patch.name = name;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Enabled must be boolean." }, { status: 400 });
    patch.enabled = body.enabled;
  }
  if ("action" in body) {
    if (!isRuntimeSecurityAction(body.action)) {
      return NextResponse.json({ error: "Action must be alert, block, flag, or would_block." }, { status: 400 });
    }
    patch.action = body.action;
  }
  if ("mode" in body) {
    if (!isRuntimeSecurityRuleMode(body.mode)) {
      return NextResponse.json({ error: "Mode must be detect or enforce." }, { status: 400 });
    }
    patch.mode = body.mode;
  }
  if ("severity" in body) {
    if (!isRuntimeSecuritySeverity(body.severity)) {
      return NextResponse.json({ error: "Invalid severity." }, { status: 400 });
    }
    patch.severity = body.severity;
  }
  if ("condition" in body) {
    const condition = parseRuntimeRuleCondition(body.condition);
    if (!condition) return NextResponse.json({ error: "Condition is invalid." }, { status: 400 });
    patch.condition = condition;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" ? body.description : "";
  }

  const rule = await updateRuntimeSecurityRule(actor.email, id, patch);
  if (!rule) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({ rule });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const deleted = await deleteRuntimeSecurityRule(actor.email, id);
  if (!deleted) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
