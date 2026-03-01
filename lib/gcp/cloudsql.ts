import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { CloudSqlInstance } from "./types";

async function getMockCloudSqlInstances(): Promise<CloudSqlInstance[]> {
  const data = await import("@/fixtures/cloud-sql.json");
  return data.default as CloudSqlInstance[];
}

async function getRealCloudSqlInstances(projectIds: string[]): Promise<CloudSqlInstance[]> {
  initGoogleAuth();
  const sql = google.sqladmin("v1beta4");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await sql.instances.list({ project: projectId });
      return (res.data.items ?? []).map((inst): CloudSqlInstance => ({
        name: inst.name ?? "",
        projectId,
        region: inst.region ?? "",
        databaseVersion: inst.databaseVersion ?? "",
        tier: inst.settings?.tier ?? "",
        state: inst.state ?? "UNKNOWN",
        publicIp: inst.ipAddresses?.find((ip) => ip.type === "PRIMARY")?.ipAddress ?? undefined,
        backupEnabled: inst.settings?.backupConfiguration?.enabled ?? false,
        requireSsl: inst.settings?.ipConfiguration?.requireSsl ?? false,
      }));
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<CloudSqlInstance[]> => {
      if (r.status === "rejected") logFetchWarning("cloudsql", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getCloudSqlInstances(projectIds: string[]): Promise<CloudSqlInstance[]> {
  if (useMockData()) return getMockCloudSqlInstances();
  return getRealCloudSqlInstances(projectIds);
}
