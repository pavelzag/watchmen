import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteRuntimeSecurityRule,
  updateRuntimeSecurityRule,
} from "@/lib/runtime-security-store";
import {
  isRuntimeSecurityAction,
  isRuntimeSecuritySeverity,
  parseRuntimeRuleCondition,
} from "@/lib/runtime-security-validation";
import type { RuntimeSecurityRule } from "@/lib/runtime-security";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch = parsePatchPayload(body);
  if (!patch.ok) {
    return NextResponse.json({ error: patch.error }, { status: 400 });
  }

  const rule = await updateRuntimeSecurityRule(session.user.email, id, patch.patch);
  if (!rule) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({ rule });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteRuntimeSecurityRule(session.user.email, id);
  if (!deleted) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

function parsePatchPayload(body: Record<string, unknown>):
  | { ok: true; patch: Partial<RuntimeSecurityRule> }
  | { ok: false; error: string } {
  const patch: Partial<RuntimeSecurityRule> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { ok: false, error: "Rule name cannot be empty." };
    patch.name = name;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return { ok: false, error: "Enabled must be a boolean." };
    patch.enabled = body.enabled;
  }

  if ("action" in body) {
    if (!isRuntimeSecurityAction(body.action)) return { ok: false, error: "Action must be flag or would_block." };
    patch.action = body.action;
  }

  if ("severity" in body) {
    if (!isRuntimeSecuritySeverity(body.severity)) {
      return { ok: false, error: "Severity must be low, medium, high, or critical." };
    }
    patch.severity = body.severity;
  }

  if ("condition" in body) {
    const condition = parseRuntimeRuleCondition(body.condition);
    if (!condition) return { ok: false, error: "Condition is invalid." };
    patch.condition = condition;
  }

  if ("description" in body) {
    patch.description = typeof body.description === "string" ? body.description : "";
  }

  return { ok: true, patch };
}
