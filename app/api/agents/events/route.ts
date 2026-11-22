import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { publishLiveTraceEvent, type LiveTraceIngressEvent } from "@/lib/live-trace-bus";
import { redactRawHttpPayload, redactSensitivePath, sanitizeRemoteIp } from "@/lib/privacy";
import { getRuntimeSecurityRulesForEvaluation, saveRuntimeRequestEvent } from "@/lib/runtime-security-store";
import { normalizeAgentEventRow } from "@/lib/runtime-security";

function parseStatus(value: unknown): number | null {
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  if (typeof value === "number") return value;
  return null;
}

function extractHeaderValue(raw: unknown, headerName: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const headerRe = new RegExp(`^${headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "im");
  return raw.match(headerRe)?.[1]?.trim();
}

function toLiveTraceEvent(input: {
  agentId: string;
  userEmail: string;
  provider: string;
  projectId: string;
  instanceName: string;
  clusterName: string | null;
  event: any;
  status: number | null;
}): LiveTraceIngressEvent | null {
  const method = typeof input.event?.method === "string" ? input.event.method : undefined;
  const path = redactSensitivePath(typeof input.event?.path === "string" ? input.event.path : undefined);
  if (!method && !path && input.status === null) return null;

  const isK8s = input.provider === "k8s";
  const clusterName = input.clusterName || input.projectId || "kubernetes";
  const resourceName = isK8s
    ? clusterName
    : (input.instanceName || input.clusterName || input.agentId);
  const timestamp = typeof input.event?.timestamp === "string" ? input.event.timestamp : new Date().toISOString();
  const traceId = typeof input.event?.traceId === "string"
    ? input.event.traceId
    : typeof input.event?.trace_id === "string"
      ? input.event.trace_id
      : `${input.agentId}:${timestamp}:${method ?? "HTTP"}:${path ?? "/"}`;
  const rawData = redactRawHttpPayload(typeof input.event?.data === "string" ? input.event.data : undefined);
  const kernelSourceIp = typeof input.event?.sourceIp === "string" && input.event.sourceIp.trim()
    ? input.event.sourceIp.trim()
    : undefined;
  const forwardedSourceIp = extractHeaderValue(rawData, "X-Watchmen-Source-IP")
    ?? extractHeaderValue(rawData, "X-Forwarded-For")
    ?? extractHeaderValue(rawData, "X-Real-IP");

  return {
    id: `agent:${traceId}`,
    cloud: isK8s ? "kubernetes" : "gcp",
    kind: isK8s ? "gke" : "vm",
    projectId: isK8s ? clusterName : (input.projectId || "gcp"),
    resourceName,
    container: typeof input.event?.pod === "string"
      ? input.event.pod
      : typeof input.event?.containerId === "string"
        ? input.event.containerId
        : typeof input.event?.container === "string"
          ? input.event.container
          : !isK8s && typeof input.event?.comm === "string"
            ? input.event.comm
            : undefined,
    timestamp,
    method,
    path,
    status: input.status ?? undefined,
    latency: typeof input.event?.latency === "string" ? input.event.latency : undefined,
    remoteIp: sanitizeRemoteIp(kernelSourceIp ?? forwardedSourceIp ?? (typeof input.event?.remoteIp === "string" ? input.event.remoteIp : undefined)),
    userAgent: typeof input.event?.userAgent === "string" ? input.event.userAgent : extractHeaderValue(rawData, "User-Agent"),
    rawData,
    count: 1,
  };
}

export async function POST(req: NextRequest) {
  const agentId = req.headers.get("x-watchmen-agent-id") ?? "";
  const agentSecret = req.headers.get("x-watchmen-agent-secret") ?? "";
  if (!agentId || !agentSecret) {
    return NextResponse.json({ error: "Missing agent credentials." }, { status: 401 });
  }

  const secretHash = createHash("sha256").update(agentSecret).digest("hex");

  let host;
  try {
    host = await sql<{
      id: string;
      user_email: string;
      provider: string;
      project_id: string;
      instance_name: string;
      cluster_name: string | null;
    }>`
      SELECT id, user_email, provider, project_id, instance_name, metadata->>'clusterName' AS cluster_name FROM agent_hosts
      WHERE id = ${agentId} AND secret_hash = ${secretHash}
      LIMIT 1
    `;
  } catch (error) {
    console.warn("[api/agents/events] failed to authenticate agent", {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Agent registry temporarily unavailable." }, { status: 503 });
  }
  if (host.rows.length === 0) {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 403 });
  }

  const rawEvent = await req.json();
  const event = {
    ...rawEvent,
    ...(typeof rawEvent?.path === "string" ? { path: redactSensitivePath(rawEvent.path) } : {}),
    ...(typeof rawEvent?.data === "string" ? { data: redactRawHttpPayload(rawEvent.data) ?? "" } : {}),
    ...(typeof rawEvent?.sourceIp === "string" ? { sourceIp: sanitizeRemoteIp(rawEvent.sourceIp) } : {}),
    ...(typeof rawEvent?.remoteIp === "string" ? { remoteIp: sanitizeRemoteIp(rawEvent.remoteIp) } : {}),
  };
  const hostRow = host.rows[0];
  const status = parseStatus(event?.status);
  const liveEvent = toLiveTraceEvent({
    agentId,
    userEmail: hostRow.user_email,
    provider: hostRow.provider,
    projectId: hostRow.project_id,
    instanceName: hostRow.instance_name,
    clusterName: hostRow.cluster_name,
    event,
    status,
  });
  if (liveEvent) publishLiveTraceEvent(hostRow.user_email || "system", liveEvent);

  let durable = true;
  try {
    const inserted = await sql<{ id: number; received_at: Date }>`
      INSERT INTO agent_events (agent_id, provider, project_id, event, event_type, http_status, http_method, http_path, cluster_name)
      VALUES (
        ${agentId},
        ${hostRow.provider},
        ${hostRow.project_id},
        ${JSON.stringify(event)}::jsonb,
        ${event?.type ?? null},
        ${status},
        ${event?.method ?? null},
        ${event?.path ?? null},
        ${hostRow.cluster_name ?? null}
      )
      RETURNING id, received_at
    `;
    await sql`
      UPDATE agent_hosts SET last_seen_at = NOW(), status = 'healthy'
      WHERE id = ${agentId}
    `;

    try {
      const rules = await getRuntimeSecurityRulesForEvaluation(hostRow.user_email);
      const runtimeEvent = normalizeAgentEventRow({
        id: inserted.rows[0]?.id ?? crypto.randomUUID(),
        event,
        received_at: inserted.rows[0]?.received_at ?? new Date(),
        cluster_name: hostRow.cluster_name,
      }, rules);
      await saveRuntimeRequestEvent(hostRow.user_email, runtimeEvent);
    } catch (error) {
      console.warn("[api/agents/events] runtime security write failed", {
        agentId,
        clusterName: hostRow.cluster_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    durable = false;
    console.warn("[api/agents/events] durable event write failed", {
      agentId,
      clusterName: hostRow.cluster_name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return NextResponse.json({ ok: true, durable });
}
