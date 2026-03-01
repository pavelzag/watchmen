import { google } from "googleapis";

let _initialized = false;
let _userAuthInitialized = false;

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
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform.read-only"],
  });

  // Set auth globally — avoids TypeScript overload issues on individual clients
  google.options({ auth } as Parameters<typeof google.options>[0]);
}

/**
 * Initializes googleapis with a user OAuth access token globally.
 * Call this before any google.* API call when using per-user OAuth.
 */
export function initUserAuth(accessToken: string) {
  _userAuthInitialized = true;
  _initialized = false; // reset SA auth flag so SA isn't mixed in

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

/**
 * Logs a per-project fetch failure.
 * "API not enabled" errors are expected for projects that don't use a service — logged at info.
 * Anything else (permissions, network, etc.) is logged at warn.
 */
export function logFetchWarning(fetcher: string, projectId: string, reason: unknown) {
  const msg = (reason instanceof Error ? reason.message : String(reason)).split("\n")[0];
  const isExpected =
    msg.includes("has not been used") ||
    msg.includes("is disabled") ||
    msg.includes("not enabled") ||
    msg.includes("has not enabled") ||
    msg.includes("BigQuery is not enabled");
  if (isExpected) {
    console.info(`[${fetcher}] skipping ${projectId}: API not enabled`);
  } else {
    console.warn(`[${fetcher}] ${projectId} warning:`, reason);
  }
}

export function useMockData(): boolean {
  return process.env.USE_MOCK_DATA === "true";
}

export function getProjectIds(): string[] {
  return (process.env.GCP_PROJECTS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
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
