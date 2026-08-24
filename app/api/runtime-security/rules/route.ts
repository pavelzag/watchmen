import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createRuntimeSecurityRule,
  getRuntimeSecurityRules,
} from "@/lib/runtime-security-store";
import {
  isRuntimeSecuritySeverity,
  parseRuntimeRuleCondition,
} from "@/lib/runtime-security-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await getRuntimeSecurityRules(session.user.email);
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = parseRulePayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const rule = await createRuntimeSecurityRule(session.user.email, parsed.rule);
  return NextResponse.json({ rule }, { status: 201 });
}

function parseRulePayload(body: Record<string, unknown>):
  | { ok: true; rule: Parameters<typeof createRuntimeSecurityRule>[1] }
  | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Rule name is required." };

  const action = body.action;
  if (action !== "flag" && action !== "would_block") {
    return { ok: false, error: "Action must be flag or would_block." };
  }

  const severity = body.severity;
  if (!isRuntimeSecuritySeverity(severity)) {
    return { ok: false, error: "Severity must be low, medium, high, or critical." };
  }

  const condition = parseRuntimeRuleCondition(body.condition);
  if (!condition) {
    return { ok: false, error: "Condition is invalid." };
  }

  return {
    ok: true,
    rule: {
      name,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      action,
      condition,
      severity,
      description: typeof body.description === "string" ? body.description : "",
    },
  };
}
