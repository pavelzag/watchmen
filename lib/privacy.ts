const DEFAULT_SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "sig",
  "signature",
  "key",
  "api_key",
  "apikey",
  "jwt",
  "code",
  "secret",
  "password",
  "passwd",
  "auth",
  "access_token",
  "refresh_token",
  "id_token",
]);

const SENSITIVE_HEADER_NAMES = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-watchmen-agent-secret",
  "x-auth-token",
];

function parseCsvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function shouldRedactSecrets(): boolean {
  return process.env.WATCHMEN_REDACT_SECRETS !== "false";
}

export function shouldTruncateIps(): boolean {
  return process.env.WATCHMEN_TRUNCATE_IPS === "true";
}

export function shouldOmitRawData(): boolean {
  return process.env.WATCHMEN_OMIT_RAW_DATA === "true";
}

function getSensitiveQueryKeys(extraKeys?: string[]): Set<string> {
  const keys = new Set(DEFAULT_SENSITIVE_QUERY_KEYS);
  for (const k of parseCsvList(process.env.WATCHMEN_REDACT_QUERY_KEYS)) {
    keys.add(k.toLowerCase());
  }
  for (const k of extraKeys ?? []) {
    keys.add(k.toLowerCase());
  }
  return keys;
}

function redactPathTokenSegments(pathname: string): string {
  const prefixes = parseCsvList(process.env.WATCHMEN_REDACT_PATH_PREFIXES);
  if (prefixes.length === 0) return pathname;

  let result = pathname;
  for (const rawPrefix of prefixes) {
    const normalized = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    if (result.startsWith(prefix)) {
      const rest = result.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        if (rest.length > 0) result = `${prefix}REDACTED`;
      } else if (slashIdx > 0) {
        result = `${prefix}REDACTED${rest.slice(slashIdx)}`;
      }
    }
  }
  return result;
}

export function redactSensitivePath(rawPath: string | undefined, extraKeys?: string[]): string | undefined {
  if (!rawPath) return rawPath;
  if (!shouldRedactSecrets()) return rawPath;

  const sensitiveKeys = getSensitiveQueryKeys(extraKeys);
  const queryIndex = rawPath.indexOf("?");
  if (queryIndex === -1) {
    return redactPathTokenSegments(rawPath);
  }

  const basePath = redactPathTokenSegments(rawPath.slice(0, queryIndex));
  const rawQuery = rawPath.slice(queryIndex + 1);
  const redactedPairs = rawQuery.split("&").map((pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) return pair;
    const key = pair.slice(0, eqIdx);
    let decodedKey = key;
    try {
      decodedKey = decodeURIComponent(key);
    } catch {
      // Keep raw key when malformed
    }
    if (sensitiveKeys.has(decodedKey.toLowerCase())) {
      return `${key}=REDACTED`;
    }
    return pair;
  });

  return `${basePath}?${redactedPairs.join("&")}`;
}

export function redactRawHttpPayload(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  if (shouldOmitRawData()) return undefined;
  if (!shouldRedactSecrets()) return raw;

  const lines = raw.split(/\r?\n/);
  const redactedLines = lines.map((line, index) => {
    if (index === 0) {
      const reqMatch = line.match(/^([A-Z]+)\s+(\S+)(\s+HTTP\/\S+)?$/);
      if (reqMatch) {
        const [, method, target, proto = ""] = reqMatch;
        return `${method} ${redactSensitivePath(target) ?? target}${proto}`;
      }
      return line;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const headerName = line.slice(0, colonIdx).trim().toLowerCase();
      if (SENSITIVE_HEADER_NAMES.includes(headerName)) {
        return `${line.slice(0, colonIdx)}: REDACTED`;
      }
    }
    return line;
  });

  return redactedLines.join("\n");
}

export function truncateIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const trimmed = ip.trim();
  if (!trimmed) return undefined;

  const withoutBrackets = trimmed.replace(/^\[|\]$/g, "");
  const ipv4Parts = withoutBrackets.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.0`;
  }

  if (withoutBrackets.includes(":")) {
    const groups = withoutBrackets.split(":").filter((_, idx, arr) => !(idx === arr.length - 1 && arr[idx] === ""));
    const prefix = groups.slice(0, 3).join(":");
    return prefix ? `${prefix}::` : "::";
  }

  return trimmed;
}

export function sanitizeRemoteIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const trimmed = ip.trim();
  if (!trimmed) return undefined;
  return shouldTruncateIps() ? truncateIpAddress(trimmed) : trimmed;
}
