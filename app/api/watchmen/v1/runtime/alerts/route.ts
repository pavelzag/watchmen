import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import type { RuntimeSecurityDecisionAction, RuntimeSecuritySeverity } from "@/lib/runtime-security";
import {
  getRuntimeSecurityRules,
  queryRuntimeRequestEvents,
} from "@/lib/runtime-security-store";
import { isRuntimeSecuritySeverity } from "@/lib/runtime-security-validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const decisionParam = sp.get("decision") ?? undefined;
  if (
    decisionParam &&
    decisionParam !== "flagged" &&
    decisionParam !== "would_block" &&
    decisionParam !== "blocked"
  ) {
    return NextResponse.json({ error: "Invalid alert decision filter." }, { status: 400 });
  }

  const severityParam = sp.get("severity") ?? undefined;
  if (severityParam && !isRuntimeSecuritySeverity(severityParam)) {
    return NextResponse.json({ error: "Invalid severity filter." }, { status: 400 });
  }

  const limitRaw = Number(sp.get("limit") ?? "100");
  const cursorRaw = Number(sp.get("cursor") ?? "0");

  const [rules, queried] = await Promise.all([
    getRuntimeSecurityRules(actor.email),
    queryRuntimeRequestEvents(actor.email, {
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      decision: decisionParam as RuntimeSecurityDecisionAction | undefined,
      ruleId: sp.get("ruleId") ?? undefined,
      severity: severityParam as RuntimeSecuritySeverity | undefined,
      limit: 2000,
      sort: sp.get("sort") === "asc" ? "asc" : "desc",
    }),
  ]);

  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  const alertEvents = queried.events.filter((event) => event.decision !== "allow");
  const offset = Math.max(Number.isFinite(cursorRaw) ? cursorRaw : 0, 0);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const page = alertEvents.slice(offset, offset + limit);

  const alerts = page.map((event) => ({
    requestId: event.id,
    ts: event.ts,
    decision: event.decision,
    severity: event.highestSeverity ?? "low",
    method: event.method,
    path: event.path,
    sourceIp: event.sourceIp,
    sourceIpClass: event.sourceIpClass,
    statusCode: event.statusCode,
    reasons: event.reasons ?? [],
    matchedRules: event.matchedRuleIds.map((ruleId) => {
      const rule = ruleMap.get(ruleId);
      return rule
        ? { id: rule.id, name: rule.name, action: rule.action, mode: rule.mode ?? "detect", severity: rule.severity }
        : { id: ruleId, name: ruleId };
    }),
  }));

  return NextResponse.json({
    alerts,
    total: alertEvents.length,
    nextCursor: offset + page.length < alertEvents.length ? offset + page.length : null,
  });
}
