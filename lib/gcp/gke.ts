import { google } from "googleapis";
import { initGoogleAuth, useMockData } from "./client";
import type { GkeCluster } from "./types";

async function getMockClusters(): Promise<GkeCluster[]> {
  const data = await import("@/fixtures/gke-clusters.json");
  return data.default as GkeCluster[];
}

async function getRealClusters(projectIds: string[]): Promise<GkeCluster[]> {
  initGoogleAuth();
  const container = google.container("v1");
  const crm = google.cloudresourcemanager("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await container.projects.locations.clusters.list({
        parent: `projects/${projectId}/locations/-`,
      });
      const clusters = res.data.clusters ?? [];

      // Fetch project-level IAM once, then filter container.* roles per cluster
      const policyRes = await crm.projects.getIamPolicy({
        resource: projectId,
        requestBody: {},
      });
      const containerBindings = (policyRes.data.bindings ?? [])
        .filter((b) => b.role?.startsWith("roles/container"))
        .map((b) => ({ role: b.role ?? "", members: b.members ?? [] }));

      return clusters.map((cluster): GkeCluster => {
        const location = cluster.location ?? cluster.zone ?? "unknown";
        return {
          name: cluster.name ?? "",
          projectId,
          location,
          locationType:
            location.split("-").length === 3 ? "zonal" : "regional",
          status: cluster.status ?? "UNKNOWN",
          currentMasterVersion: cluster.currentMasterVersion ?? "",
          nodeCount: cluster.currentNodeCount ?? 0,
          iamPolicy: { bindings: containerBindings },
        };
      });
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<GkeCluster[]> => {
      if (r.status === "rejected") console.warn(`[gke] ${projectIds[i]} failed:`, r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getGkeClusters(
  projectIds: string[]
): Promise<GkeCluster[]> {
  if (useMockData()) return getMockClusters();
  return getRealClusters(projectIds);
}
