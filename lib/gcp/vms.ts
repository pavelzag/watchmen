import { google } from "googleapis";
import { initGoogleAuth, useMockData } from "./client";
import type { VM } from "./types";

async function getMockVMs(): Promise<VM[]> {
  const data = await import("@/fixtures/vms.json");
  return data.default as VM[];
}

async function getRealVMs(projectIds: string[]): Promise<VM[]> {
  initGoogleAuth();
  const compute = google.compute("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await compute.instances.aggregatedList({ project: projectId });
      const items = res.data.items ?? {};
      const vms: VM[] = [];

      for (const [zoneKey, zoneData] of Object.entries(items)) {
        const zone = zoneKey.replace("zones/", "");
        for (const instance of zoneData.instances ?? []) {
          vms.push({
            name: instance.name ?? "",
            projectId,
            zone,
            machineType: instance.machineType?.split("/").pop() ?? "",
            status: instance.status ?? "UNKNOWN",
            internalIp: instance.networkInterfaces?.[0]?.networkIP ?? "",
            externalIp:
              instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ??
              null,
            serviceAccount: instance.serviceAccounts?.[0]?.email ?? null,
            tags: instance.tags?.items ?? [],
            createdAt: instance.creationTimestamp ?? undefined,
          });
        }
      }
      return vms;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<VM[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

export async function getVMs(projectIds: string[]): Promise<VM[]> {
  if (useMockData()) return getMockVMs();
  return getRealVMs(projectIds);
}
