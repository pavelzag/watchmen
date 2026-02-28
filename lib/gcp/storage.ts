import { google } from "googleapis";
import { initGoogleAuth, useMockData } from "./client";
import type { StorageBucket } from "./types";

async function getMockBuckets(): Promise<StorageBucket[]> {
  const data = await import("@/fixtures/storage-buckets.json");
  return data.default as StorageBucket[];
}

async function getRealBuckets(projectIds: string[]): Promise<StorageBucket[]> {
  initGoogleAuth();
  const storage = google.storage("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const listRes = await storage.buckets.list({ project: projectId });
      const buckets = listRes.data.items ?? [];

      const withPolicies = await Promise.allSettled(
        buckets.map(async (bucket): Promise<StorageBucket> => {
          const policyRes = await storage.buckets.getIamPolicy({
            bucket: bucket.name!,
            optionsRequestedPolicyVersion: 3,
          });
          return {
            name: bucket.name ?? "",
            projectId,
            location: bucket.location ?? "",
            storageClass: bucket.storageClass ?? "",
            iamPolicy: {
              bindings: (policyRes.data.bindings ?? []).map((b) => ({
                role: b.role ?? "",
                members: b.members ?? [],
              })),
            },
          };
        })
      );

      return withPolicies
        .filter(
          (r): r is PromiseFulfilledResult<StorageBucket> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<StorageBucket[]> =>
        r.status === "fulfilled"
    )
    .flatMap((r) => r.value);
}

export async function getStorageBuckets(
  projectIds: string[]
): Promise<StorageBucket[]> {
  if (useMockData()) return getMockBuckets();
  return getRealBuckets(projectIds);
}
