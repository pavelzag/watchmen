import type { LiveTraceIngressEvent } from "@/lib/live-trace-bus";

export type RuntimeSecurityAction = "flag" | "would_block";
export type RuntimeSecurityDecisionAction = "allow" | "flagged" | "would_block";
export type RuntimeSecuritySeverity = "low" | "medium" | "high" | "critical";
export type SourceIpClass = "public" | "private" | "loopback" | "link_local" | "unknown";

export type RuntimeSecurityRuleCondition =
  | { kind: "method"; value: string }
  | { kind: "path_prefix"; value: string }
  | { kind: "content_type"; value: string }
  | { kind: "body_contains"; value: string }
  | { kind: "source_ip_class"; value: "public" | "private" };

export interface RuntimeSecurityRule {
  id: string;
  name: string;
  enabled: boolean;
  action: RuntimeSecurityAction;
  condition: RuntimeSecurityRuleCondition;
  severity: RuntimeSecuritySeverity;
  description?: string;
  matchCount?: number;
  lastMatchedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeRequestEvent {
  id: string;
  ts: string;
  sourceIp?: string;
  sourcePort?: number;
  sourceIpClass?: SourceIpClass;
  sourceGeo?: {
    lat: number;
    lon: number;
    region?: string;
    city?: string;
    country?: string;
  };
  method?: string;
  path?: string;
  contentType?: string;
  bodySize?: number;
  bodySample?: string;
  statusCode?: number;
  destinationService?: string;
  destinationNamespace?: string;
  destinationPod?: string;
  destinationWorkload?: string;
  decision: RuntimeSecurityDecisionAction;
  matchedRuleIds: string[];
  reasons?: string[];
  highestSeverity?: RuntimeSecuritySeverity;
}

export interface RuntimeSecurityDecision {
  requestId: string;
  action: RuntimeSecurityDecisionAction;
  matchedRuleIds: string[];
  reasons: string[];
  highestSeverity?: RuntimeSecuritySeverity;
}

const SEVERITY_RANK: Record<RuntimeSecuritySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const DEFAULT_RUNTIME_SECURITY_RULES: RuntimeSecurityRule[] = [
  {
    id: "default-method-delete",
    name: "Flag DELETE requests",
    enabled: true,
    action: "flag",
    condition: { kind: "method", value: "DELETE" },
    severity: "high",
    description: "Detects destructive HTTP methods observed in live traffic.",
  },
  {
    id: "default-path-admin",
    name: "Would-block admin paths",
    enabled: true,
    action: "would_block",
    condition: { kind: "path_prefix", value: "/admin" },
    severity: "critical",
    description: "Marks sensitive admin endpoints as enforcement candidates.",
  },
  {
    id: "default-content-audio-wav",
    name: "Flag audio uploads",
    enabled: true,
    action: "flag",
    condition: { kind: "content_type", value: "audio/wav" },
    severity: "medium",
    description: "Detects audio payloads for the runtime security demo path.",
  },
  {
    id: "default-body-red",
    name: "Flag demo body marker",
    enabled: false,
    action: "flag",
    condition: { kind: "body_contains", value: "red" },
    severity: "medium",
    description: "Demo-only payload sample rule. Keep raw body capture bounded.",
  },
  {
    id: "default-public-source",
    name: "Flag public source traffic",
    enabled: true,
    action: "flag",
    condition: { kind: "source_ip_class", value: "public" },
    severity: "medium",
    description: "Detects traffic whose observed source IP is publicly routable.",
  },
];

export function classifySourceIp(ip: string | undefined): SourceIpClass {
  if (!ip) return "unknown";

  const cleaned = ip.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) return "unknown";

  if (cleaned === "::1") return "loopback";
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(cleaned)) return "private";
  if (/^fe80:/i.test(cleaned)) return "link_local";

  const parts = cleaned.split(".");
  if (parts.length !== 4) return "unknown";

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return "unknown";
  }

  const [a, b] = octets;
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link_local";
  if (a === 100 && b >= 64 && b <= 127) return "private";

  return "public";
}

export function evaluateRuntimeRules(
  event: RuntimeRequestEvent,
  rules: RuntimeSecurityRule[],
): RuntimeSecurityDecision {
  const matchedRules = rules.filter((rule) => rule.enabled && ruleMatchesEvent(rule, event));
  const hasWouldBlock = matchedRules.some((rule) => rule.action === "would_block");

  const highestSeverity = matchedRules.reduce<RuntimeSecuritySeverity | undefined>((highest, rule) => {
    if (!highest || SEVERITY_RANK[rule.severity] > SEVERITY_RANK[highest]) {
      return rule.severity;
    }
    return highest;
  }, undefined);

  return {
    requestId: event.id,
    action: matchedRules.length === 0 ? "allow" : hasWouldBlock ? "would_block" : "flagged",
    matchedRuleIds: matchedRules.map((rule) => rule.id),
    reasons: matchedRules.map((rule) => reasonForMatch(rule, event)),
    highestSeverity,
  };
}

export function applyRuntimeDecision(
  event: Omit<RuntimeRequestEvent, "decision" | "matchedRuleIds"> & Partial<Pick<RuntimeRequestEvent, "decision" | "matchedRuleIds">>,
  rules: RuntimeSecurityRule[],
): RuntimeRequestEvent {
  const sourceIpClass = event.sourceIpClass ?? classifySourceIp(event.sourceIp);
  const baseEvent: RuntimeRequestEvent = {
    ...event,
    sourceIpClass,
    decision: event.decision ?? "allow",
    matchedRuleIds: event.matchedRuleIds ?? [],
  };
  const decision = evaluateRuntimeRules(baseEvent, rules);

  return {
    ...baseEvent,
    decision: decision.action,
    matchedRuleIds: decision.matchedRuleIds,
    reasons: decision.reasons,
    highestSeverity: decision.highestSeverity,
  };
}

export function normalizeLiveTraceEvent(
  event: LiveTraceIngressEvent,
  rules: RuntimeSecurityRule[],
): RuntimeRequestEvent {
  return applyRuntimeDecision({
    id: event.id,
    ts: event.timestamp,
    sourceIp: event.remoteIp,
    method: normalizeMethod(event.method),
    path: event.path,
    statusCode: event.status,
    destinationService: event.resourceName,
    destinationWorkload: event.container,
  }, rules);
}

export function normalizeAgentEventRow(
  row: {
    id: number | string;
    event: Record<string, unknown>;
    received_at: string | Date;
    cluster_name?: string | null;
  },
  rules: RuntimeSecurityRule[],
): RuntimeRequestEvent {
  const event = row.event ?? {};
  const sourceIp = stringValue(event.remoteIp)
    ?? stringValue(event.sourceIp)
    ?? stringValue(event.clientIp)
    ?? stringValue(event["x-forwarded-for"])?.split(",")[0]?.trim()
    ?? headerValue(stringValue(event.data), "X-Watchmen-Source-IP")
    ?? headerValue(stringValue(event.data), "X-Forwarded-For")
    ?? headerValue(stringValue(event.data), "X-Real-IP");

  return applyRuntimeDecision({
    id: `agent-${row.id}`,
    ts: row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
    sourceIp,
    sourcePort: numberValue(event.sourcePort),
    sourceGeo: geoValue(event),
    method: normalizeMethod(stringValue(event.method)),
    path: stringValue(event.path),
    contentType: stringValue(event.contentType) ?? stringValue(event.content_type),
    bodySize: numberValue(event.bodySize) ?? numberValue(event.body_size),
    bodySample: stringValue(event.bodySample) ?? stringValue(event.body_sample),
    statusCode: numberValue(event.status),
    destinationService: stringValue(event.service) ?? stringValue(event.destinationService) ?? row.cluster_name ?? undefined,
    destinationNamespace: stringValue(event.namespace) ?? stringValue(event.destinationNamespace),
    destinationPod: stringValue(event.pod) ?? stringValue(event.destinationPod),
    destinationWorkload: stringValue(event.workload) ?? stringValue(event.destinationWorkload) ?? stringValue(event.hostname),
  }, rules);
}

function ruleMatchesEvent(rule: RuntimeSecurityRule, event: RuntimeRequestEvent): boolean {
  const condition = rule.condition;
  switch (condition.kind) {
    case "method":
      return normalizeMethod(event.method) === condition.value.trim().toUpperCase();
    case "path_prefix":
      return Boolean(event.path?.startsWith(condition.value));
    case "content_type":
      return normalizeContentType(event.contentType) === normalizeContentType(condition.value);
    case "body_contains":
      return Boolean(event.bodySample?.toLowerCase().includes(condition.value.toLowerCase()));
    case "source_ip_class": {
      const sourceClass = event.sourceIpClass ?? classifySourceIp(event.sourceIp);
      if (condition.value === "private") {
        return sourceClass === "private" || sourceClass === "loopback" || sourceClass === "link_local";
      }
      return sourceClass === "public";
    }
  }
}

function reasonForMatch(rule: RuntimeSecurityRule, event: RuntimeRequestEvent): string {
  const condition = rule.condition;
  switch (condition.kind) {
    case "method":
      return `${rule.name}: method ${event.method ?? "unknown"} matched ${condition.value}`;
    case "path_prefix":
      return `${rule.name}: path ${event.path ?? "unknown"} matched prefix ${condition.value}`;
    case "content_type":
      return `${rule.name}: content-type ${event.contentType ?? "unknown"} matched ${condition.value}`;
    case "body_contains":
      return `${rule.name}: body sample contained configured marker`;
    case "source_ip_class":
      return `${rule.name}: source IP ${event.sourceIp ?? "unknown"} classified as ${event.sourceIpClass ?? classifySourceIp(event.sourceIp)}`;
  }
}

function normalizeMethod(method: string | undefined): string | undefined {
  return method?.trim().toUpperCase() || undefined;
}

function normalizeContentType(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase() || undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function headerValue(raw: string | undefined, name: string): string | undefined {
  if (!raw) return undefined;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedName}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.split(",")[0]?.trim() || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function coordinateValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function geoValue(event: Record<string, unknown>): RuntimeRequestEvent["sourceGeo"] | undefined {
  const nested = typeof event.sourceGeo === "object" && event.sourceGeo !== null
    ? event.sourceGeo as Record<string, unknown>
    : typeof event.geo === "object" && event.geo !== null
      ? event.geo as Record<string, unknown>
      : undefined;
  const lat = coordinateValue(nested?.lat)
    ?? coordinateValue(nested?.latitude)
    ?? coordinateValue(event.sourceLat)
    ?? coordinateValue(event.sourceLatitude)
    ?? coordinateValue(event.lat)
    ?? coordinateValue(event.latitude);
  const lon = coordinateValue(nested?.lon)
    ?? coordinateValue(nested?.lng)
    ?? coordinateValue(nested?.longitude)
    ?? coordinateValue(event.sourceLon)
    ?? coordinateValue(event.sourceLng)
    ?? coordinateValue(event.sourceLongitude)
    ?? coordinateValue(event.lon)
    ?? coordinateValue(event.lng)
    ?? coordinateValue(event.longitude);

  if (lat === undefined || lon === undefined || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return undefined;
  }

  return {
    lat,
    lon,
    region: stringValue(nested?.region) ?? stringValue(event.sourceRegion) ?? stringValue(event.region),
    city: stringValue(nested?.city) ?? stringValue(event.sourceCity) ?? stringValue(event.city),
    country: stringValue(nested?.country) ?? stringValue(event.sourceCountry) ?? stringValue(event.country),
  };
}
