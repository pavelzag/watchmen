import { createHash } from "crypto";
import { verifyShirudoKeepaliveQuote } from "@/lib/shirudo/tpm-verify";

export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  kvlistValue?: { values?: Array<{ key?: string; value?: OtlpAnyValue }> };
  arrayValue?: { values?: OtlpAnyValue[] };
}

export interface OtlpKeyValue {
  key?: string;
  value?: OtlpAnyValue;
}

export interface ShirudoQuoteParsed {
  present: boolean;
  akName: string | null;
  hasAttest: boolean;
  hasSig: boolean;
  hasAk: boolean;
}

export type ShirudoConditionStatus = "unset" | "ok" | "warn" | "alert";

export interface ShirudoDecodedCondition {
  name:
    | "LsmAttached"
    | "KeyringSealed"
    | "ChainIntact"
    | "UpatchesMeasured"
    | "TpmMeasured"
    | "ConfigActive"
    | "XdpCovered";
  status: ShirudoConditionStatus;
}

export interface ShirudoKeepaliveBody {
  schema: string;
  boot_id?: string;
  version_id?: string;
  config_root?: string | null;
  kernel_release?: string;
  image_id?: string | null;
  image_version?: string | null;
  image_root?: string | null;
  verdict: string;
  cond: number;
  flags: number;
  tamper?: number[] | null;
  integrity?: number[] | null;
  tree_id?: string | null;
  generation?: number | null;
  base_seq?: number | null;
  last_seq?: number | null;
  base_root?: string | null;
  projection_root?: string | null;
  mask?: string | null;
  set_sha256?: string | null;
  count?: number;
  not_ok?: number;
}

export interface ParsedShirudoKeepalive {
  nodeKey: string;
  hostName: string;
  akName: string | null;
  quotePresent: boolean;
  quoteVerified: boolean;
  tpmResetCount: number | null;
  tpmClock: string | null;
  quoteVerificationError: string | null;
  serviceVersion: string;
  observedAt: string;
  tamperTotal: number;
  integrityTotal: number;
  body: ShirudoKeepaliveBody;
}

export interface ParsedShirudoMapSnapshot {
  nodeKey: string;
  hostName: string;
  upatchId: string;
  mapName: string;
  advisoryId: string | null;
  hitCount: number;
  observedAt: string;
  payload: Record<string, unknown>;
}

export interface ParsedShirudoMetricHit {
  nodeKey: string;
  hostName: string;
  upatchId: string;
  mapName: string;
  advisoryId: string | null;
  hitCount: number;
  observedAt: string;
  payload: Record<string, unknown>;
}

const CONDITION_NAMES: ShirudoDecodedCondition["name"][] = [
  "LsmAttached",
  "KeyringSealed",
  "ChainIntact",
  "UpatchesMeasured",
  "TpmMeasured",
  "ConfigActive",
  "XdpCovered",
];

function attrString(attrs: OtlpKeyValue[] | undefined, key: string): string | undefined {
  if (!Array.isArray(attrs)) return undefined;
  for (const entry of attrs) {
    if (entry?.key === key) {
      if (typeof entry.value?.stringValue === "string") return entry.value.stringValue;
      if (entry.value?.intValue !== undefined) return String(entry.value.intValue);
      if (entry.value?.doubleValue !== undefined) return String(entry.value.doubleValue);
      if (entry.value?.boolValue !== undefined) return String(entry.value.boolValue);
    }
  }
  return undefined;
}

function attrsToObject(attrs: OtlpKeyValue[] | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Array.isArray(attrs)) return out;
  for (const entry of attrs) {
    if (!entry?.key || !entry.value) continue;
    if (typeof entry.value.stringValue === "string") out[entry.key] = entry.value.stringValue;
    else if (entry.value.intValue !== undefined) out[entry.key] = Number(entry.value.intValue);
    else if (entry.value.doubleValue !== undefined) out[entry.key] = entry.value.doubleValue;
    else if (entry.value.boolValue !== undefined) out[entry.key] = entry.value.boolValue;
  }
  return out;
}

function nanoToIso(timeUnixNano: unknown): string {
  if (typeof timeUnixNano === "string" && /^\d+$/.test(timeUnixNano)) {
    const ms = Number(BigInt(timeUnixNano) / BigInt(1_000_000));
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } else if (typeof timeUnixNano === "number" && Number.isFinite(timeUnixNano)) {
    const date = new Date(Math.floor(timeUnixNano / 1_000_000));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function decodeCondBits(cond: number): ShirudoDecodedCondition[] {
  return CONDITION_NAMES.map((name, idx) => {
    const bits = (cond >> (idx * 2)) & 0b11;
    const status: ShirudoConditionStatus =
      bits === 0b01 ? "ok" : bits === 0b10 ? "warn" : bits === 0b11 ? "alert" : "unset";
    return { name, status };
  });
}

/**
 * Parses Shirudo's `shirudo.quote` attribute (`attest=<b64>;sig=<b64>;ak=<b64>`).
 * Computes `ak_name` per Shirudo's spec: `"000b" + sha256(TPMT_PUBLIC)`.
 */
export function parseShirudoQuote(quoteRaw: string | undefined): ShirudoQuoteParsed {
  if (!quoteRaw || typeof quoteRaw !== "string") {
    return { present: false, akName: null, hasAttest: false, hasSig: false, hasAk: false };
  }

  const parts = new Map<string, string>();
  for (const segment of quoteRaw.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) {
      parts.set(segment.slice(0, eq).trim(), segment.slice(eq + 1).trim());
    }
  }

  const attest = parts.get("attest") ?? "";
  const sig = parts.get("sig") ?? "";
  const ak = parts.get("ak") ?? "";

  let akName: string | null = null;
  if (ak) {
    try {
      const akBytes = Buffer.from(ak, "base64");
      if (akBytes.length > 0) {
        const digest = createHash("sha256").update(akBytes).digest("hex");
        akName = `000b${digest}`;
      }
    } catch {
      akName = null;
    }
  }

  return {
    present: Boolean(attest && sig && ak),
    akName,
    hasAttest: Boolean(attest),
    hasSig: Boolean(sig),
    hasAk: Boolean(ak),
  };
}

function sumArray(nums: unknown): number {
  if (!Array.isArray(nums)) return 0;
  return nums.reduce<number>((sum, n) => (typeof n === "number" && Number.isFinite(n) ? sum + n : sum), 0);
}

function extractCveFromObject(obj: Record<string, unknown>): string | null {
  for (const key of ["advisory", "advisory_id", "cve", "cve_id", "vuln_id"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim().toUpperCase();
    }
  }
  const serialized = JSON.stringify(obj);
  const match = serialized.match(/\bCVE-\d{4}-\d{4,7}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractPositiveHitCount(obj: Record<string, unknown>): number {
  for (const key of ["hits", "hit_count", "blocked", "blocks", "count", "value"]) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      return Math.trunc(v);
    }
    if (typeof v === "string" && /^\d+$/.test(v)) {
      return Number(v);
    }
  }
  return 1;
}

export function parseOtlpLogsPayload(rawBody: unknown): {
  keepalives: ParsedShirudoKeepalive[];
  mapSnapshots: ParsedShirudoMapSnapshot[];
  totalRecords: number;
} {
  const payload = (rawBody ?? {}) as {
    resourceLogs?: Array<{
      resource?: { attributes?: OtlpKeyValue[] };
      scopeLogs?: Array<{
        scope?: { name?: string; version?: string };
        logRecords?: Array<{
          timeUnixNano?: string | number;
          observedTimeUnixNano?: string | number;
          eventName?: string;
          body?: OtlpAnyValue;
          attributes?: OtlpKeyValue[];
        }>;
      }>;
    }>;
  };

  const keepalives: ParsedShirudoKeepalive[] = [];
  const mapSnapshots: ParsedShirudoMapSnapshot[] = [];
  let totalRecords = 0;

  for (const resLog of payload.resourceLogs ?? []) {
    const resAttrs = resLog?.resource?.attributes;
    const hostName = attrString(resAttrs, "host.name") ?? "unknown";
    const serviceVersion = attrString(resAttrs, "service.version") ?? "";

    for (const scopeLog of resLog?.scopeLogs ?? []) {
      const scopeName = scopeLog?.scope?.name ?? "";

      for (const rec of scopeLog?.logRecords ?? []) {
        totalRecords += 1;
        const observedAt = nanoToIso(rec?.timeUnixNano ?? rec?.observedTimeUnixNano);
        const eventName = rec?.eventName ?? "";
        const bodyStr = typeof rec?.body?.stringValue === "string" ? rec.body.stringValue : "";
        const recAttrs = attrsToObject(rec?.attributes);

        if (eventName === "shirudo.keepalive" || scopeName === "shirudo.keepalive") {
          let parsedBody: ShirudoKeepaliveBody | null = null;
          if (bodyStr) {
            try {
              parsedBody = JSON.parse(bodyStr) as ShirudoKeepaliveBody;
            } catch {
              parsedBody = null;
            }
          }
          if (!parsedBody || typeof parsedBody !== "object") continue;

          const quoteRaw = attrString(rec?.attributes, "shirudo.quote");
          const quote = parseShirudoQuote(quoteRaw);
          const quoteVerification = quote.present
            ? verifyShirudoKeepaliveQuote(quoteRaw, bodyStr)
            : null;
          const nodeKey = quote.akName ?? `host:${hostName}`;

          keepalives.push({
            nodeKey,
            hostName,
            akName: quote.akName,
            quotePresent: quote.present,
            quoteVerified: Boolean(quoteVerification?.verified),
            tpmResetCount: quoteVerification?.resetCount ?? null,
            tpmClock: quoteVerification?.clock ?? null,
            quoteVerificationError:
              quoteVerification && !quoteVerification.verified ? quoteVerification.reason ?? "Quote invalid" : null,
            serviceVersion,
            observedAt,
            tamperTotal: sumArray(parsedBody.tamper),
            integrityTotal: sumArray(parsedBody.integrity),
            body: {
              ...parsedBody,
              schema: parsedBody.schema || "shirudo.keepalive/1",
              verdict: parsedBody.verdict || "unknown",
              cond: Number(parsedBody.cond ?? 0),
              flags: Number(parsedBody.flags ?? 0),
            },
          });
          continue;
        }

        if (eventName === "shirudo.bpf.map.snapshot" || scopeName === "shirudo.upatch.maps") {
          let parsedMap: Record<string, unknown> = {};
          if (bodyStr) {
            try {
              const maybeObj = JSON.parse(bodyStr) as unknown;
              if (maybeObj && typeof maybeObj === "object" && !Array.isArray(maybeObj)) {
                parsedMap = maybeObj as Record<string, unknown>;
              } else {
                parsedMap = { value: maybeObj };
              }
            } catch {
              parsedMap = { text: bodyStr };
            }
          }

          const upatchId =
            (typeof recAttrs["shirudo.upatch"] === "string" && recAttrs["shirudo.upatch"]) ||
            (typeof recAttrs.upatch === "string" && recAttrs.upatch) ||
            (typeof parsedMap.upatch === "string" && parsedMap.upatch) ||
            (typeof parsedMap.upatch_id === "string" && parsedMap.upatch_id) ||
            "kernel-obs";

          const mapName =
            (typeof recAttrs["shirudo.map"] === "string" && recAttrs["shirudo.map"]) ||
            (typeof recAttrs.map === "string" && recAttrs.map) ||
            (typeof parsedMap.map === "string" && parsedMap.map) ||
            "snapshot";

          const akFromAttr = typeof recAttrs["shirudo.ak_name"] === "string" ? recAttrs["shirudo.ak_name"] : null;
          const merged = { ...recAttrs, ...parsedMap };
          const advisoryId = extractCveFromObject(merged);
          const hitCount = extractPositiveHitCount(merged);

          mapSnapshots.push({
            nodeKey: akFromAttr ?? `host:${hostName}`,
            hostName,
            upatchId,
            mapName,
            advisoryId,
            hitCount,
            observedAt,
            payload: merged,
          });
        }
      }
    }
  }

  return { keepalives, mapSnapshots, totalRecords };
}

export function parseOtlpMetricsPayload(rawBody: unknown): {
  hits: ParsedShirudoMetricHit[];
  totalDataPoints: number;
} {
  const payload = (rawBody ?? {}) as {
    resourceMetrics?: Array<{
      resource?: { attributes?: OtlpKeyValue[] };
      scopeMetrics?: Array<{
        metrics?: Array<{
          name?: string;
          sum?: { dataPoints?: Array<{ asInt?: string | number; asDouble?: number; timeUnixNano?: string | number; attributes?: OtlpKeyValue[] }> };
          gauge?: { dataPoints?: Array<{ asInt?: string | number; asDouble?: number; timeUnixNano?: string | number; attributes?: OtlpKeyValue[] }> };
        }>;
      }>;
    }>;
  };

  const hits: ParsedShirudoMetricHit[] = [];
  let totalDataPoints = 0;

  for (const resMetric of payload.resourceMetrics ?? []) {
    const resAttrs = resMetric?.resource?.attributes;
    const hostName = attrString(resAttrs, "host.name") ?? "unknown";

    for (const scopeMetric of resMetric?.scopeMetrics ?? []) {
      for (const metric of scopeMetric?.metrics ?? []) {
        const metricName = metric?.name ?? "shirudo_metric";
        const dataPoints = [
          ...(metric?.sum?.dataPoints ?? []),
          ...(metric?.gauge?.dataPoints ?? []),
        ];

        for (const dp of dataPoints) {
          totalDataPoints += 1;
          const dpAttrs = attrsToObject(dp?.attributes);
          const rawVal = dp?.asInt !== undefined ? Number(dp.asInt) : Number(dp?.asDouble ?? 0);
          const hitCount = Number.isFinite(rawVal) && rawVal >= 0 ? Math.trunc(rawVal) : 0;

          const upatchId =
            (typeof dpAttrs["shirudo.upatch"] === "string" && dpAttrs["shirudo.upatch"]) ||
            (typeof dpAttrs.upatch === "string" && dpAttrs.upatch) ||
            (typeof dpAttrs.upatch_id === "string" && dpAttrs.upatch_id) ||
            metricName;

          const mapName =
            (typeof dpAttrs["shirudo.map"] === "string" && dpAttrs["shirudo.map"]) ||
            metricName;

          const akFromAttr = typeof dpAttrs["shirudo.ak_name"] === "string" ? dpAttrs["shirudo.ak_name"] : null;
          const advisoryId = extractCveFromObject(dpAttrs);

          hits.push({
            nodeKey: akFromAttr ?? `host:${hostName}`,
            hostName,
            upatchId,
            mapName,
            advisoryId,
            hitCount,
            observedAt: nanoToIso(dp?.timeUnixNano),
            payload: { metric: metricName, value: rawVal, ...dpAttrs },
          });
        }
      }
    }
  }

  return { hits, totalDataPoints };
}
