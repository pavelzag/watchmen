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
        const svcName = nameParts[nameParts.length - 1] ?? svc.metadata?.name ?? "";
        const region = svc.metadata?.labels?.["cloud.googleapis.com/location"] ?? "";

        // Fetch IAM policy for this service so pathsPublicCloudRunSa can detect allUsers bindings
        let iamBindings: { role: string; members: string[] }[] = [];
        if (svcName && region) {
          try {
            const iamRes = await run.projects.locations.services.getIamPolicy({
              resource: `projects/${projectId}/locations/${region}/services/${svcName}`,
            });
            iamBindings = (iamRes.data.bindings ?? []).map((b) => ({
              role: b.role ?? "",
              members: b.members ?? [],
            }));
          } catch {
            // IAM fetch failure is non-fatal — service is included without policy
          }
        }

        services.push({
          name: svcName,
          projectId,
          region,
          url: svc.status?.url ?? undefined,
          status: svc.status?.conditions?.[0]?.status === "True" ? "ACTIVE" : "INACTIVE",
          serviceAccount: svc.spec?.template?.spec?.serviceAccountName ?? undefined,
          iamPolicy: { bindings: iamBindings },
          envVars: Object.fromEntries(
            (svc.spec?.template?.spec?.containers?.[0]?.env ?? [])
              .filter((e) => e.name != null && e.value !== undefined)
              .map((e) => [e.name as string, e.value ?? ""] as [string, string])
          ),
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

export async function getCloudRunServices(
  projectIds: string[],
  forceMock?: boolean
): Promise<CloudRunService[]> {
  if (useMockData(forceMock)) return getMockCloudRunServices();
  return getRealCloudRunServices(projectIds);
}
