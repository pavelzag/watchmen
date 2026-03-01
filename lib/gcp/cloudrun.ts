import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { CloudRunService } from "./types";

async function getMockCloudRunServices(): Promise<CloudRunService[]> {
  const data = await import("@/fixtures/cloud-run.json");
  return data.default as CloudRunService[];
}

async function getRealCloudRunServices(projectIds: string[]): Promise<CloudRunService[]> {
  initGoogleAuth();
  const run = google.run("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await run.projects.locations.services.list({
        parent: `projects/${projectId}/locations/-`,
      });
      const services: CloudRunService[] = [];
      for (const svc of res.data.items ?? []) {
        const nameParts = (svc.metadata?.name ?? "").split("/");
        const locationParts = (svc.metadata?.namespace ?? "").split("/");
        services.push({
          name: nameParts[nameParts.length - 1] ?? svc.metadata?.name ?? "",
          projectId,
          region: locationParts[locationParts.length - 1] ?? "",
          url: svc.status?.url ?? undefined,
          status: svc.status?.conditions?.[0]?.status === "True" ? "ACTIVE" : "INACTIVE",
          serviceAccount: svc.spec?.template?.spec?.serviceAccountName ?? undefined,
          iamPolicy: { bindings: [] },
        });
      }
      return services;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<CloudRunService[]> => {
      if (r.status === "rejected") logFetchWarning("cloudrun", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getCloudRunServices(projectIds: string[]): Promise<CloudRunService[]> {
  if (useMockData()) return getMockCloudRunServices();
  return getRealCloudRunServices(projectIds);
}
