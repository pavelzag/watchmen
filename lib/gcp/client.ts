import { google } from "googleapis";
import type { GcpScanWarning, GcpScanWarningCode } from "./types";
import { buildGcpEnableApiCommand, buildGcpGrantCommands, getGcpRequiredApi, getGcpRequiredRoles } from "./scan-coverage";

let _initialized = false;
let _userAuthInitialized = false;
let _scanWarnings: GcpScanWarning[] = [];
let _scannerPrincipal: string | undefined;

/**
 * Initializes googleapis with the service account credentials globally.
 * Must be called before any google.* API call in real (non-mock) mode.
 */
export function initGoogleAuth() {
  if (_initialized || _userAuthInitialized) return;
  _initialized = true;

  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GCP_SERVICE_ACCOUNT_KEY is not set");

  const credentials = JSON.parse(
    Buffer.from(raw, "base64").toString("utf-8")
  ) as { client_email?: string };
  _scannerPrincipal = credentials.client_email ? `serviceAccount:${credentials.client_email}` : undefined;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  // Set auth globally — avoids TypeScript overload issues on individual clients
  google.options({ auth } as Parameters<typeof google.options>[0]);
}

/**
 * Initializes googleapis with a service account key JSON string directly.
 * Use this for per-user SA credentials stored in DB.
 */
export function initGoogleAuthFromKey(saKeyJson: string) {
  _initialized = true;
  _userAuthInitialized = false;

  const credentials = JSON.parse(saKeyJson) as { client_email?: string };
  _scannerPrincipal = credentials.client_email ? `serviceAccount:${credentials.client_email}` : undefined;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  google.options({ auth } as Parameters<typeof google.options>[0]);
}

export function getProjectIdFromServiceAccountKey(saKeyJson: string): string | null {
  try {
    const credentials = JSON.parse(saKeyJson) as { project_id?: unknown };
    return typeof credentials.project_id === "string" && credentials.project_id.trim()
      ? credentials.project_id.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Initializes googleapis with a user OAuth access token globally.
 * Call this before any google.* API call when using per-user OAuth.
 */
export function initUserAuth(accessToken: string) {
  _userAuthInitialized = true;
  _initialized = false; // reset SA auth flag so SA isn't mixed in
  _scannerPrincipal = undefined;

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: accessToken });
  google.options({ auth } as Parameters<typeof google.options>[0]);
}

/**
 * Discovers all GCP projects the user has access to via their OAuth token.
 */
export async function discoverUserProjectIds(accessToken: string): Promise<string[]> {
  try {
    initUserAuth(accessToken);
    const crm = google.cloudresourcemanager("v1");
    const res = await crm.projects.list({
      filter: "lifecycleState:ACTIVE",
    });
    const ids = (res.data.projects ?? [])
      .map((p) => p.projectId ?? "")
      .filter(Boolean);
    console.log(`[user-auth] Discovered ${ids.length} accessible project(s)`);
    return ids;
  } catch (err) {
    console.warn("[user-auth] Failed to discover projects:", err);
    return [];
  }
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? value.trim();
}

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) {
    const parts = [reason.name, reason.message, (reason as Error & { code?: string }).code]
      .filter(Boolean)
      .join(": ");
    return firstLine(parts || reason.message || reason.name);
  }

  if (typeof reason === "string") return firstLine(reason);

  if (reason && typeof reason === "object") {
    const maybeMessage = (reason as { message?: string }).message;
    const maybeCode = (reason as { code?: unknown }).code;
    const maybeStatus = (reason as { response?: { status?: number } }).response?.status;
    const joined = [maybeMessage, maybeCode, maybeStatus ? `status ${maybeStatus}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (joined) return firstLine(joined);
    try {
      return firstLine(JSON.stringify(reason));
    } catch {
      return "Unknown error";
    }
  }

  return String(reason);
}

function classifyGcpFetchError(reason: unknown): { code: GcpScanWarningCode; retryable: boolean; detail: string } {
  const detail = stringifyReason(reason);
  const normalized = detail.toLowerCase();
  const rawErrorCode = (reason as { code?: unknown } | undefined)?.code;
  const errorCode = typeof rawErrorCode === "string" ? rawErrorCode.toUpperCase() : "";
  const status =
    (reason as { response?: { status?: number } } | undefined)?.response?.status ??
    (typeof rawErrorCode === "number" ? rawErrorCode : undefined);

  if (
    normalized.includes("has not been used") ||
    normalized.includes("is disabled") ||
    normalized.includes("not enabled") ||
    normalized.includes("has not enabled")
  ) {
    return { code: "api_not_enabled", retryable: false, detail };
  }

  if (
    status === 403 ||
    normalized.includes("permission denied") ||
    normalized.includes("does not have") ||
    normalized.includes("access denied") ||
    normalized.includes("insufficient authentication scopes")
  ) {
    return { code: "permission_denied", retryable: false, detail };
  }

  if (
    status === 401 ||
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("token has been expired") ||
    normalized.includes("unauthenticated")
  ) {
    return { code: "unauthenticated", retryable: false, detail };
  }

  if (status === 404 || normalized.includes("not found")) {
    return { code: "not_found", retryable: false, detail };
  }

  if (
    errorCode === "ETIMEDOUT" ||
    errorCode === "ESOCKETTIMEDOUT" ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return { code: "timeout", retryable: true, detail };
  }

  if (status === 429 || normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return { code: "rate_limited", retryable: true, detail };
  }

  if (
    errorCode === "ECONNRESET" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "EAI_AGAIN" ||
    normalized.includes("socket hang up") ||
    normalized.includes("fetch failed")
  ) {
    return { code: "transient_network", retryable: true, detail };
  }

  if (status && status >= 500) {
    return { code: "transient_network", retryable: true, detail };
  }

  return { code: "unknown", retryable: false, detail };
}

function humanMessage(fetcher: string, projectId: string, code: GcpScanWarningCode): string {
  switch (code) {
    case "api_not_enabled":
      return `${fetcher} skipped for ${projectId}: API not enabled.`;
    case "permission_denied":
      return `${fetcher} skipped for ${projectId}: this identity does not have permission to access that service.`;
    case "unauthenticated":
      return `${fetcher} skipped for ${projectId}: credentials are missing, expired, or missing required scopes.`;
    case "not_found":
      return `${fetcher} skipped for ${projectId}: project or service endpoint was not found.`;
    case "timeout":
      return `${fetcher} could not be checked for ${projectId}: the request timed out.`;
    case "rate_limited":
      return `${fetcher} could not be checked for ${projectId}: the API rate limit was hit.`;
    case "transient_network":
      return `${fetcher} could not be checked for ${projectId}: a transient network error occurred.`;
    default:
      return `${fetcher} could not be checked for ${projectId}: an unexpected error occurred.`;
  }
}

export function resetGcpScanWarnings(): void {
  _scanWarnings = [];
}

export function getGcpScanWarnings(): GcpScanWarning[] {
  return [..._scanWarnings];
}

export function logFetchWarning(fetcher: string, projectId: string, reason: unknown): GcpScanWarning {
  const { code, retryable, detail } = classifyGcpFetchError(reason);
  const warning: GcpScanWarning = {
    service: fetcher,
    projectId,
    code,
    retryable,
    message: humanMessage(fetcher, projectId, code),
    detail,
    principal: _scannerPrincipal,
    requiredRoles: getGcpRequiredRoles(fetcher),
    requiredApi: getGcpRequiredApi(fetcher),
    grantCommands: buildGcpGrantCommands(projectId, _scannerPrincipal, fetcher),
    enableApiCommand: buildGcpEnableApiCommand(projectId, fetcher) ?? undefined,
  };
  _scanWarnings.push(warning);

  if (code === "api_not_enabled") {
    console.info(`[${fetcher}] skipping ${projectId}: API not enabled`);
  } else if (code === "permission_denied") {
    console.info(`[${fetcher}] skipping ${projectId}: permission denied`);
  } else if (code === "unauthenticated") {
    console.error(`[${fetcher}] auth error for ${projectId}: ${detail}`);
  } else if (retryable) {
    console.warn(`[${fetcher}] ${projectId}: temporary failure (${code})`);
  } else {
    console.warn(`[${fetcher}] ${projectId}: ${code}`);
  }

  return warning;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withProjectRetry<T>(
  fetcher: string,
  projectId: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyGcpFetchError(error);
      const canRetry = classification.retryable && attempt < attempts;
      if (!canRetry) break;

      const backoffMs = attempt * 750;
      console.info(`[${fetcher}] retrying ${projectId} after ${classification.code} (${attempt}/${attempts})`);
      await delay(backoffMs);
    }
  }

  throw lastError;
}

export function useMockData(forced?: boolean): boolean {
  if (forced !== undefined) return forced;
  return process.env.USE_MOCK_DATA === "true" || process.env.DEMO_MODE === "true";
}

export function getProjectIds(): string[] {
  const exampleProjectIds = new Set(["my-project-id", "another-project-id"]);
  return (process.env.GCP_PROJECTS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((projectId) => projectId && !exampleProjectIds.has(projectId));
}

/**
 * If GCP_ORG_ID is set (and not in mock mode), enumerate all projects in the org.
 * Falls back to getProjectIds() if org enumeration fails or org ID is not set.
 */
export async function getProjectIdsForOrg(): Promise<string[]> {
  const orgId = process.env.GCP_ORG_ID;
  if (!orgId || process.env.USE_MOCK_DATA === "true") {
    return getProjectIds();
  }

  try {
    initGoogleAuth();
    const { google } = await import("googleapis");
    const crm = google.cloudresourcemanager("v1");
    const res = await crm.projects.list({
      filter: `parent.type:organization parent.id:${orgId} lifecycleState:ACTIVE`,
    });
    const ids = (res.data.projects ?? [])
      .map((p) => p.projectId ?? "")
      .filter(Boolean);
    console.log(`[org] Discovered ${ids.length} projects in org ${orgId}`);
    return ids.length > 0 ? ids : getProjectIds();
  } catch (err) {
    console.warn("[org] Failed to enumerate org projects, falling back to GCP_PROJECTS:", err);
    return getProjectIds();
  }
}
