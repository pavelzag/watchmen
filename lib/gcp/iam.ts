import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { ProjectIamPolicy, ServiceAccount } from "./types";

async function getMockProjectPolicies(): Promise<ProjectIamPolicy[]> {
  const data = await import("@/fixtures/iam-policies.json");
  return Object.values(data.default) as ProjectIamPolicy[];
}

async function getMockServiceAccounts(): Promise<ServiceAccount[]> {
  const data = await import("@/fixtures/service-accounts.json");
  return data.default as ServiceAccount[];
}

async function getRealProjectPolicies(
  projectIds: string[]
): Promise<ProjectIamPolicy[]> {
  initGoogleAuth();
  const crm = google.cloudresourcemanager("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId): Promise<ProjectIamPolicy> => {
      const [policyRes, projectRes] = await Promise.all([
        crm.projects.getIamPolicy({ resource: projectId, requestBody: {} }),
        crm.projects.get({ projectId }),
      ]);
      return {
        projectId,
        projectName: projectRes.data.name ?? projectId,
        bindings: (policyRes.data.bindings ?? []).map((b) => ({
          role: b.role ?? "",
          members: b.members ?? [],
        })),
      };
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<ProjectIamPolicy> => {
      if (r.status === "rejected") logFetchWarning("iam/policies", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .map((r) => r.value);
}

async function getRealServiceAccounts(
  projectIds: string[]
): Promise<ServiceAccount[]> {
  initGoogleAuth();
  const iam = google.iam("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await iam.projects.serviceAccounts.list({
        name: `projects/${projectId}`,
      });
      return (res.data.accounts ?? []).map(
        (sa): ServiceAccount => ({
          name: sa.name ?? "",
          projectId,
          uniqueId: sa.uniqueId ?? "",
          email: sa.email ?? "",
          displayName: sa.displayName ?? sa.email ?? "",
          description: sa.description ?? undefined,
          disabled: sa.disabled ?? false,
          roles: [],
          keys: [],
          createdAt: undefined, // IAM list API does not return createTime for service accounts
        })
      );
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<ServiceAccount[]> => {
      if (r.status === "rejected") logFetchWarning("iam/service-accounts", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getProjectPolicies(
  projectIds: string[]
): Promise<ProjectIamPolicy[]> {
  if (useMockData()) return getMockProjectPolicies();
  return getRealProjectPolicies(projectIds);
}

export async function getServiceAccounts(
  projectIds: string[]
): Promise<ServiceAccount[]> {
  if (useMockData()) return getMockServiceAccounts();
  return getRealServiceAccounts(projectIds);
}
