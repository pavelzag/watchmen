import { ensureAgentInstallTables, ensureRuntimeSecurityTables, sql } from "@/lib/db";
import {
  DEFAULT_RUNTIME_SECURITY_RULES,
  normalizeAgentEventRow,
  type RuntimeRequestEvent,
  type RuntimeSecurityRule,
  type RuntimeSecurityRuleCondition,
} from "@/lib/runtime-security";

type RuntimeRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  action: RuntimeSecurityRule["action"];
  condition_kind: RuntimeSecurityRuleCondition["kind"];
  condition_value: string;
  severity: RuntimeSecurityRule["severity"];
  description: string;
  created_at: Date;
  updated_at: Date;
  match_count: number | null;
  last_matched_at: Date | null;
};

type RuntimeEventRow = {
  id: string;
  ts: Date;
  source_ip: string | null;
  source_port: number | null;
  source_ip_class: RuntimeRequestEvent["sourceIpClass"] | null;
  source_geo_lat: number | null;
  source_geo_lon: number | null;
  source_geo_region: string | null;
  source_geo_city: string | null;
  source_geo_country: string | null;
  method: string | null;
  path: string | null;
  content_type: string | null;
  body_size: number | null;
  body_sample: string | null;
  status_code: number | null;
  destination_service: string | null;
  destination_namespace: string | null;
  destination_pod: string | null;
  destination_workload: string | null;
  decision: RuntimeRequestEvent["decision"];
  matched_rule_ids: string[];
  reasons: string[];
  highest_severity: RuntimeRequestEvent["highestSeverity"] | null;
};

export async function getRuntimeSecurityRules(userEmail: string): Promise<RuntimeSecurityRule[]> {
  await ensureRuntimeSecurityTables();
  await seedDefaultRuntimeSecurityRules(userEmail);

  const result = await sql<RuntimeRuleRow>`
    SELECT
      r.id,
      r.name,
      r.enabled,
      r.action,
      r.condition_kind,
      r.condition_value,
      r.severity,
      r.description,
      r.created_at,
      r.updated_at,
      COUNT(e.id)::int AS match_count,
      MAX(e.ts) AS last_matched_at
    FROM runtime_security_rules r
    LEFT JOIN runtime_request_events e
      ON e.user_email = r.user_email
     AND e.matched_rule_ids ? r.id
    WHERE r.user_email = ${userEmail}
    GROUP BY r.id, r.name, r.enabled, r.action, r.condition_kind, r.condition_value, r.severity, r.description, r.created_at, r.updated_at
    ORDER BY r.created_at ASC
  `;

  return result.rows.map(ruleFromRow);
}

export async function createRuntimeSecurityRule(
  userEmail: string,
  rule: Omit<RuntimeSecurityRule, "id"> & { id?: string },
): Promise<RuntimeSecurityRule> {
  await ensureRuntimeSecurityTables();
  const id = rule.id || `rule-${crypto.randomUUID()}`;

  await sql`
    INSERT INTO runtime_security_rules (
      user_email, id, name, enabled, action, condition_kind, condition_value, severity, description
    )
    VALUES (
      ${userEmail},
      ${id},
      ${rule.name},
      ${rule.enabled},
      ${rule.action},
      ${rule.condition.kind},
      ${rule.condition.value},
      ${rule.severity},
      ${rule.description ?? ""}
    )
  `;

  return { ...rule, id };
}

export async function updateRuntimeSecurityRule(
  userEmail: string,
  id: string,
  patch: Partial<Omit<RuntimeSecurityRule, "id" | "createdAt" | "updatedAt" | "matchCount" | "lastMatchedAt">>,
): Promise<RuntimeSecurityRule | null> {
  const rules = await getRuntimeSecurityRules(userEmail);
  const current = rules.find((rule) => rule.id === id);
  if (!current) return null;

  const next: RuntimeSecurityRule = {
    ...current,
    ...patch,
    condition: patch.condition ?? current.condition,
  };

  await sql`
    UPDATE runtime_security_rules
    SET
      name = ${next.name},
      enabled = ${next.enabled},
      action = ${next.action},
      condition_kind = ${next.condition.kind},
      condition_value = ${next.condition.value},
      severity = ${next.severity},
      description = ${next.description ?? ""},
      updated_at = NOW()
    WHERE user_email = ${userEmail} AND id = ${id}
  `;

  return next;
}

export async function deleteRuntimeSecurityRule(userEmail: string, id: string): Promise<boolean> {
  await ensureRuntimeSecurityTables();
  const result = await sql`
    DELETE FROM runtime_security_rules
    WHERE user_email = ${userEmail} AND id = ${id}
  `;
  return (result.rowCount ?? 0) > 0;
}

export async function saveRuntimeRequestEvent(userEmail: string, event: RuntimeRequestEvent): Promise<void> {
  await ensureRuntimeSecurityTables();
  await sql`
    INSERT INTO runtime_request_events (
      user_email,
      id,
      ts,
      source_ip,
      source_port,
      source_ip_class,
      source_geo_lat,
      source_geo_lon,
      source_geo_region,
      source_geo_city,
      source_geo_country,
      method,
      path,
      content_type,
      body_size,
      body_sample,
      status_code,
      destination_service,
      destination_namespace,
      destination_pod,
      destination_workload,
      decision,
      matched_rule_ids,
      reasons,
      highest_severity
    )
    VALUES (
      ${userEmail},
      ${event.id},
      ${event.ts},
      ${event.sourceIp ?? null},
      ${event.sourcePort ?? null},
      ${event.sourceIpClass ?? null},
      ${event.sourceGeo?.lat ?? null},
      ${event.sourceGeo?.lon ?? null},
      ${event.sourceGeo?.region ?? null},
      ${event.sourceGeo?.city ?? null},
      ${event.sourceGeo?.country ?? null},
      ${event.method ?? null},
      ${event.path ?? null},
      ${event.contentType ?? null},
      ${event.bodySize ?? null},
      ${event.bodySample ?? null},
      ${event.statusCode ?? null},
      ${event.destinationService ?? null},
      ${event.destinationNamespace ?? null},
      ${event.destinationPod ?? null},
      ${event.destinationWorkload ?? null},
      ${event.decision},
      ${JSON.stringify(event.matchedRuleIds)}::jsonb,
      ${JSON.stringify(event.reasons ?? [])}::jsonb,
      ${event.highestSeverity ?? null}
    )
    ON CONFLICT (user_email, id) DO UPDATE SET
      ts = EXCLUDED.ts,
      source_ip = EXCLUDED.source_ip,
      source_port = EXCLUDED.source_port,
      source_ip_class = EXCLUDED.source_ip_class,
      source_geo_lat = EXCLUDED.source_geo_lat,
      source_geo_lon = EXCLUDED.source_geo_lon,
      source_geo_region = EXCLUDED.source_geo_region,
      source_geo_city = EXCLUDED.source_geo_city,
      source_geo_country = EXCLUDED.source_geo_country,
      method = EXCLUDED.method,
      path = EXCLUDED.path,
      content_type = EXCLUDED.content_type,
      body_size = EXCLUDED.body_size,
      body_sample = EXCLUDED.body_sample,
      status_code = EXCLUDED.status_code,
      destination_service = EXCLUDED.destination_service,
      destination_namespace = EXCLUDED.destination_namespace,
      destination_pod = EXCLUDED.destination_pod,
      destination_workload = EXCLUDED.destination_workload,
      decision = EXCLUDED.decision,
      matched_rule_ids = EXCLUDED.matched_rule_ids,
      reasons = EXCLUDED.reasons,
      highest_severity = EXCLUDED.highest_severity
  `;
}

export async function listRuntimeRequestEvents(userEmail: string, limit = 100): Promise<RuntimeRequestEvent[]> {
  await ensureRuntimeSecurityTables();
  const rules = await getRuntimeSecurityRules(userEmail);

  const persisted = await sql<RuntimeEventRow>`
    SELECT
      id,
      ts,
      source_ip,
      source_port,
      source_ip_class,
      source_geo_lat,
      source_geo_lon,
      source_geo_region,
      source_geo_city,
      source_geo_country,
      method,
      path,
      content_type,
      body_size,
      body_sample,
      status_code,
      destination_service,
      destination_namespace,
      destination_pod,
      destination_workload,
      decision,
      matched_rule_ids,
      reasons,
      highest_severity
    FROM runtime_request_events
    WHERE user_email = ${userEmail}
    ORDER BY ts DESC
    LIMIT ${limit}
  `;

  let agentEvents: RuntimeRequestEvent[] = [];
  try {
    await ensureAgentInstallTables();
    const agentRows = await sql<{
      id: number;
      event: Record<string, unknown>;
      received_at: Date;
      cluster_name: string | null;
    }>`
      SELECT e.id, e.event, e.received_at, COALESCE(e.cluster_name, h.metadata->>'clusterName') AS cluster_name
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE (h.user_email = ${userEmail} OR h.user_email = 'system')
        AND (e.event_type = 'http_request' OR e.http_method IS NOT NULL OR e.http_path IS NOT NULL)
      ORDER BY e.received_at DESC
      LIMIT ${limit}
    `;
    agentEvents = agentRows.rows.map((row) => normalizeAgentEventRow(row, rules));
  } catch (error) {
    console.warn("[runtime-security] failed to load agent events", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const merged = [...persisted.rows.map(eventFromRow), ...agentEvents]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const seen = new Set<string>();
  return merged.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  }).slice(0, limit);
}

async function seedDefaultRuntimeSecurityRules(userEmail: string): Promise<void> {
  const existing = await sql<{ count: string }>`
    SELECT COUNT(*)::text AS count
    FROM runtime_security_rules
    WHERE user_email = ${userEmail}
  `;
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  for (const rule of DEFAULT_RUNTIME_SECURITY_RULES) {
    await createRuntimeSecurityRule(userEmail, rule);
  }
}

function ruleFromRow(row: RuntimeRuleRow): RuntimeSecurityRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    action: row.action,
    condition: {
      kind: row.condition_kind,
      value: row.condition_value,
    } as RuntimeSecurityRuleCondition,
    severity: row.severity,
    description: row.description,
    matchCount: row.match_count ?? 0,
    lastMatchedAt: row.last_matched_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function eventFromRow(row: RuntimeEventRow): RuntimeRequestEvent {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    sourceIp: row.source_ip ?? undefined,
    sourcePort: row.source_port ?? undefined,
    sourceIpClass: row.source_ip_class ?? undefined,
    sourceGeo: row.source_geo_lat === null || row.source_geo_lon === null
      ? undefined
      : {
        lat: row.source_geo_lat,
        lon: row.source_geo_lon,
        region: row.source_geo_region ?? undefined,
        city: row.source_geo_city ?? undefined,
        country: row.source_geo_country ?? undefined,
      },
    method: row.method ?? undefined,
    path: row.path ?? undefined,
    contentType: row.content_type ?? undefined,
    bodySize: row.body_size ?? undefined,
    bodySample: row.body_sample ?? undefined,
    statusCode: row.status_code ?? undefined,
    destinationService: row.destination_service ?? undefined,
    destinationNamespace: row.destination_namespace ?? undefined,
    destinationPod: row.destination_pod ?? undefined,
    destinationWorkload: row.destination_workload ?? undefined,
    decision: row.decision,
    matchedRuleIds: row.matched_rule_ids ?? [],
    reasons: row.reasons ?? [],
    highestSeverity: row.highest_severity ?? undefined,
  };
}
