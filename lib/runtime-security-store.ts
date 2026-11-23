import { ensureAgentInstallTables, ensureRuntimeSecurityTables, sql } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import { enrichRuntimeEventGeo } from "@/lib/ip-geolocation";
import { DEMO_RUNTIME_RULES, getDemoRuntimeRequestEvents } from "@/lib/mock/runtime-events";
import {
  DEFAULT_RUNTIME_SECURITY_RULES,
  normalizeAgentEventRow,
  type RuntimeRequestEvent,
  type RuntimeSecurityDecisionAction,
  type RuntimeSecurityRule,
  type RuntimeSecurityRuleCondition,
  type RuntimeSecurityRuleMode,
  type RuntimeSecuritySeverity,
} from "@/lib/runtime-security";

type RuntimeRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  action: RuntimeSecurityRule["action"];
  mode: RuntimeSecurityRuleMode | null;
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
      r.mode,
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
    GROUP BY r.id, r.name, r.enabled, r.action, r.mode, r.condition_kind, r.condition_value, r.severity, r.description, r.created_at, r.updated_at
    ORDER BY r.created_at ASC
  `;

  return result.rows.map(ruleFromRow);
}

export async function getRuntimeSecurityRule(userEmail: string, id: string): Promise<RuntimeSecurityRule | null> {
  const rules = await getRuntimeSecurityRules(userEmail);
  return rules.find((r) => r.id === id) ?? null;
}

export async function getRuntimeSecurityRulesForEvaluation(userEmail: string): Promise<RuntimeSecurityRule[]> {
  await ensureRuntimeSecurityTables();
  await seedDefaultRuntimeSecurityRules(userEmail);

  const result = await sql<RuntimeRuleRow>`
    SELECT
      id,
      name,
      enabled,
      action,
      mode,
      condition_kind,
      condition_value,
      severity,
      description,
      created_at,
      updated_at,
      0::int AS match_count,
      NULL::timestamptz AS last_matched_at
    FROM runtime_security_rules
    WHERE user_email = ${userEmail}
    ORDER BY created_at ASC
  `;

  return result.rows.map(ruleFromRow);
}

export async function createRuntimeSecurityRule(
  userEmail: string,
  rule: Omit<RuntimeSecurityRule, "id"> & { id?: string },
): Promise<RuntimeSecurityRule> {
  await ensureRuntimeSecurityTables();
  const id = rule.id || `rule-${crypto.randomUUID()}`;
  const mode: RuntimeSecurityRuleMode = rule.mode ?? "detect";

  await sql`
    INSERT INTO runtime_security_rules (
      user_email, id, name, enabled, action, mode, condition_kind, condition_value, severity, description
    )
    VALUES (
      ${userEmail},
      ${id},
      ${rule.name},
      ${rule.enabled},
      ${rule.action},
      ${mode},
      ${rule.condition.kind},
      ${rule.condition.value},
      ${rule.severity},
      ${rule.description ?? ""}
    )
  `;

  return { ...rule, mode, id };
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
    mode: patch.mode ?? current.mode ?? "detect",
    condition: patch.condition ?? current.condition,
  };

  await sql`
    UPDATE runtime_security_rules
    SET
      name = ${next.name},
      enabled = ${next.enabled},
      action = ${next.action},
      mode = ${next.mode ?? "detect"},
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
  const enrichedEvent = await enrichRuntimeEventGeo(event);
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
      ${enrichedEvent.id},
      ${enrichedEvent.ts},
      ${enrichedEvent.sourceIp ?? null},
      ${enrichedEvent.sourcePort ?? null},
      ${enrichedEvent.sourceIpClass ?? null},
      ${enrichedEvent.sourceGeo?.lat ?? null},
      ${enrichedEvent.sourceGeo?.lon ?? null},
      ${enrichedEvent.sourceGeo?.region ?? null},
      ${enrichedEvent.sourceGeo?.city ?? null},
      ${enrichedEvent.sourceGeo?.country ?? null},
      ${enrichedEvent.method ?? null},
      ${enrichedEvent.path ?? null},
      ${enrichedEvent.contentType ?? null},
      ${enrichedEvent.bodySize ?? null},
      ${enrichedEvent.bodySample ?? null},
      ${enrichedEvent.statusCode ?? null},
      ${enrichedEvent.destinationService ?? null},
      ${enrichedEvent.destinationNamespace ?? null},
      ${enrichedEvent.destinationPod ?? null},
      ${enrichedEvent.destinationWorkload ?? null},
      ${enrichedEvent.decision},
      ${JSON.stringify(enrichedEvent.matchedRuleIds)}::jsonb,
      ${JSON.stringify(enrichedEvent.reasons ?? [])}::jsonb,
      ${enrichedEvent.highestSeverity ?? null}
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
  const rules = await getRuntimeSecurityRulesForEvaluation(userEmail);

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

  const demoEvents =
    userEmail === "demo@watchmen.dev" || isDemoMode()
      ? getDemoRuntimeRequestEvents(rules)
      : [];

  const merged = [...persisted.rows.map(eventFromRow), ...agentEvents, ...demoEvents]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const seen = new Set<string>();
  return merged.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  }).slice(0, limit);
}

async function seedDefaultRuntimeSecurityRules(userEmail: string): Promise<void> {
  const isDemo = userEmail === "demo@watchmen.dev" || isDemoMode();
  const seedList = isDemo ? DEMO_RUNTIME_RULES : DEFAULT_RUNTIME_SECURITY_RULES;

  const existing = await sql<{ id: string }>`
    SELECT id
    FROM runtime_security_rules
    WHERE user_email = ${userEmail}
  `;
  const existingIds = new Set(existing.rows.map((r) => r.id));
  if (!isDemo && existingIds.size > 0) return;

  for (const rule of seedList) {
    if (!existingIds.has(rule.id)) {
      await createRuntimeSecurityRule(userEmail, rule);
    }
  }
}

function ruleFromRow(row: RuntimeRuleRow): RuntimeSecurityRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    action: row.action,
    mode: row.mode === "enforce" ? "enforce" : "detect",
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

export interface RuntimeRequestQueryFilters {
  from?: string;
  to?: string;
  decision?: RuntimeSecurityDecisionAction;
  method?: string;
  pathPrefix?: string;
  sourceIp?: string;
  sourceIpClass?: string;
  statusCode?: number;
  ruleId?: string;
  severity?: RuntimeSecuritySeverity;
  limit?: number;
  cursor?: number;
  sort?: "asc" | "desc";
}

export function filterRuntimeRequestEvents(
  events: RuntimeRequestEvent[],
  filters: RuntimeRequestQueryFilters = {},
): { events: RuntimeRequestEvent[]; total: number; nextCursor: number | null } {
  const fromMs = filters.from ? Date.parse(filters.from) : NaN;
  const toMs = filters.to ? Date.parse(filters.to) : NaN;
  const methodUpper = filters.method?.trim().toUpperCase();
  const pathPrefix = filters.pathPrefix?.trim();
  const sourceIp = filters.sourceIp?.trim();
  const sourceIpClass = filters.sourceIpClass?.trim();

  let filtered = events.filter((event) => {
    const tsMs = Date.parse(event.ts);
    if (!Number.isNaN(fromMs) && !Number.isNaN(tsMs) && tsMs < fromMs) return false;
    if (!Number.isNaN(toMs) && !Number.isNaN(tsMs) && tsMs > toMs) return false;
    if (filters.decision && event.decision !== filters.decision) return false;
    if (methodUpper && (event.method ?? "").toUpperCase() !== methodUpper) return false;
    if (pathPrefix && !(event.path ?? "").startsWith(pathPrefix)) return false;
    if (sourceIp && event.sourceIp !== sourceIp) return false;
    if (sourceIpClass && event.sourceIpClass !== sourceIpClass) return false;
    if (filters.statusCode !== undefined && event.statusCode !== filters.statusCode) return false;
    if (filters.ruleId && !event.matchedRuleIds.includes(filters.ruleId)) return false;
    if (filters.severity && event.highestSeverity !== filters.severity) return false;
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    const diff = Date.parse(b.ts) - Date.parse(a.ts);
    return filters.sort === "asc" ? -diff : diff;
  });

  const total = filtered.length;
  const offset = Math.max(filters.cursor ?? 0, 0);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const page = filtered.slice(offset, offset + limit);
  const nextCursor = offset + page.length < total ? offset + page.length : null;

  return { events: page, total, nextCursor };
}

export async function queryRuntimeRequestEvents(
  userEmail: string,
  filters: RuntimeRequestQueryFilters = {},
): Promise<{ events: RuntimeRequestEvent[]; total: number; nextCursor: number | null }> {
  const all = await listRuntimeRequestEvents(userEmail, 2000);
  return filterRuntimeRequestEvents(all, filters);
}

export async function getRuntimeRequestEventById(
  userEmail: string,
  id: string,
): Promise<RuntimeRequestEvent | null> {
  const all = await listRuntimeRequestEvents(userEmail, 2000);
  return all.find((event) => event.id === id) ?? null;
}

export async function getRuntimeSecuritySummary(
  userEmail: string,
  filters: Pick<RuntimeRequestQueryFilters, "from" | "to"> = {},
) {
  const [rules, queried] = await Promise.all([
    getRuntimeSecurityRules(userEmail),
    queryRuntimeRequestEvents(userEmail, { ...filters, limit: 2000 }),
  ]);

  const byDecision: Record<RuntimeSecurityDecisionAction, number> = {
    allow: 0,
    flagged: 0,
    would_block: 0,
    blocked: 0,
  };
  const bySeverity: Record<RuntimeSecuritySeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const ruleCounts = new Map<string, number>();
  const pathCounts = new Map<string, number>();

  for (const event of queried.events) {
    byDecision[event.decision] = (byDecision[event.decision] ?? 0) + 1;
    if (event.highestSeverity) {
      bySeverity[event.highestSeverity] = (bySeverity[event.highestSeverity] ?? 0) + 1;
    }
    for (const ruleId of event.matchedRuleIds) {
      ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + 1);
    }
    if (event.decision !== "allow" && event.path) {
      pathCounts.set(event.path, (pathCounts.get(event.path) ?? 0) + 1);
    }
  }

  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
  const topMatchedRules = [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ruleId, count]) => ({
      ruleId,
      name: ruleNameById.get(ruleId) ?? ruleId,
      count,
    }));

  const topTargetedPaths = [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return {
    totalRequests: queried.total,
    byDecision,
    bySeverity,
    activeRuleCount: rules.filter((r) => r.enabled).length,
    enforcingRuleCount: rules.filter((r) => r.enabled && r.mode === "enforce" && (r.action === "block" || r.action === "would_block")).length,
    topMatchedRules,
    topTargetedPaths,
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
