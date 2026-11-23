import {
  discoverUserProjectIds,
  getProjectIdFromServiceAccountKey,
  getProjectIdsForOrg,
  initGoogleAuthForRequest,
} from "./client";
import { getUserCloudCredentials } from "../credentials";
import { ensureGcpSnapshotTable, sql } from "../db";

async function getSnapshotProjectIds(userEmail: string): Promise<string[]> {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    return [];
  }
  try {
    await ensureGcpSnapshotTable();
    const res = await sql`
      SELECT snapshot FROM user_snapshots WHERE user_email = ${userEmail} LIMIT 1
    `;
    const snapshot = res.rows[0]?.snapshot as { projects?: Array<{ projectId?: string }> } | undefined;
    return (snapshot?.projects ?? [])
      .map((p) => p.projectId ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function resolveGcpContainerScanContext(options: {
  email: string;
  accessToken?: unknown;
}): Promise<{
  authMode: "service_account_key" | "oauth_token" | "adc" | null;
  projectIds: string[];
}> {
  const gcpCreds = await getUserCloudCredentials(options.email, "gcp");
  const serviceAccountKey = gcpCreds?.serviceAccountKey as string | undefined;
  const authMode = initGoogleAuthForRequest({
    serviceAccountKey,
    accessToken: options.accessToken,
  });

  if (!authMode) {
    return { authMode: null, projectIds: [] };
  }

  let projectIds = await getProjectIdsForOrg();
  if (projectIds.length > 0) {
    return { authMode, projectIds };
  }

  if (authMode === "oauth_token" && typeof options.accessToken === "string" && options.accessToken) {
    projectIds = await discoverUserProjectIds(options.accessToken);
    if (projectIds.length > 0) {
      return { authMode, projectIds };
    }
  }

  if (authMode === "service_account_key" && serviceAccountKey) {
    const saProjectId = getProjectIdFromServiceAccountKey(serviceAccountKey);
    if (saProjectId) {
      return { authMode, projectIds: [saProjectId] };
    }
  }

  projectIds = await getSnapshotProjectIds(options.email);
  return { authMode, projectIds };
}
