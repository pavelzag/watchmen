import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import {
  applyRuntimeDecision,
  type RuntimeSecurityDecisionAction,
  type RuntimeSecuritySeverity,
} from "@/lib/runtime-security";
import {
  getRuntimeSecurityRulesForEvaluation,
  queryRuntimeRequestEvents,
  saveRuntimeRequestEvent,
} from "@/lib/runtime-security-store";
import { isRuntimeSecuritySeverity } from "@/lib/runtime-security-validation";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set<RuntimeSecurityDecisionAction>([
  "allow",
  "flagged",
  "would_block",
  "blocked",
]);

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const decisionParam = sp.get("decision") ?? undefined;
  if (decisionParam && !VALID_DECISIONS.has(decisionParam as RuntimeSecurityDecisionAction)) {
    return NextResponse.json({ error: "Invalid decision filter." }, { status: 400 });
  }

  const severityParam = sp.get("severity") ?? undefined;
  if (severityParam && !isRuntimeSecuritySeverity(severityParam)) {
    return NextResponse.json({ error: "Invalid severity filter." }, { status: 400 });
  }

  const statusCodeRaw = sp.get("statusCode");
  const statusCode = statusCodeRaw !== null && /^\d+$/.test(statusCodeRaw) ? Number(statusCodeRaw) : undefined;
  const limitRaw = Number(sp.get("limit") ?? "100");
  const cursorRaw = Number(sp.get("cursor") ?? "0");
  const sortParam = sp.get("sort") === "asc" ? "asc" : "desc";

  const result = await queryRuntimeRequestEvents(actor.email, {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    decision: decisionParam as RuntimeSecurityDecisionAction | undefined,
    method: sp.get("method") ?? undefined,
    pathPrefix: sp.get("pathPrefix") ?? undefined,
    sourceIp: sp.get("sourceIp") ?? undefined,
    sourceIpClass: sp.get("sourceIpClass") ?? undefined,
    statusCode,
    ruleId: sp.get("ruleId") ?? undefined,
    severity: severityParam as RuntimeSecuritySeverity | undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    cursor: Number.isFinite(cursorRaw) ? cursorRaw : 0,
    sort: sortParam,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const method = typeof body.method === "string" && body.method.trim()
    ? body.method.trim().toUpperCase()
    : "GET";
  const path = typeof body.path === "string" && body.path.trim()
    ? body.path.trim()
    : "/";
  const contentType = typeof body.contentType === "string" ? body.contentType : undefined;
  const bodySample = typeof body.bodySample === "string"
    ? body.bodySample.slice(0, 512)
    : typeof body.body === "string"
      ? body.body.slice(0, 512)
      : undefined;
  const bodySize = typeof body.bodySize === "number" && Number.isFinite(body.bodySize)
    ? body.bodySize
    : bodySample
      ? Buffer.byteLength(bodySample, "utf8")
      : undefined;
  const sourceIp = typeof body.sourceIp === "string" && body.sourceIp.trim()
    ? body.sourceIp.trim()
    : req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;

  const rules = await getRuntimeSecurityRulesForEvaluation(actor.email);
  const preliminary = applyRuntimeDecision({
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : `req-${crypto.randomUUID()}`,
    ts: typeof body.ts === "string" && body.ts.trim() ? body.ts.trim() : new Date().toISOString(),
    sourceIp,
    sourcePort: typeof body.sourcePort === "number" ? body.sourcePort : undefined,
    method,
    path,
    contentType,
    bodySize,
    bodySample,
    statusCode: typeof body.statusCode === "number" ? body.statusCode : undefined,
    destinationService: typeof body.destinationService === "string" ? body.destinationService : undefined,
    destinationNamespace: typeof body.destinationNamespace === "string" ? body.destinationNamespace : undefined,
    destinationPod: typeof body.destinationPod === "string" ? body.destinationPod : undefined,
    destinationWorkload: typeof body.destinationWorkload === "string" ? body.destinationWorkload : undefined,
  }, rules);

  const event = preliminary.decision === "blocked" && preliminary.statusCode === undefined
    ? { ...preliminary, statusCode: 403 }
    : preliminary;

  await saveRuntimeRequestEvent(actor.email, event);

  const ingestOnly = body.ingestOnly === true;
  if (event.decision === "blocked" && !ingestOnly) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        error: "Request blocked by Watchmen runtime policy.",
        event,
      },
      { status: 403 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      blocked: event.decision === "blocked",
      event,
    },
    { status: 201 },
  );
}
