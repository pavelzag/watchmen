import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning, withProjectRetry } from "./client";
import type { ProjectIamPolicy, ServiceAccount, ServiceAccountKey } from "./types";

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
        withProjectRetry("iam/policies", projectId, () => crm.projects.getIamPolicy({ resource: projectId, requestBody: {} })),
        withProjectRetry("iam/policies", projectId, () => crm.projects.get({ projectId })),
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

  async function getServiceAccountKeys(projectId: string, serviceAccountName: string): Promise<ServiceAccountKey[]> {
    try {
      const res = await withProjectRetry("iam/service-account-keys", projectId, () =>
        iam.projects.serviceAccounts.keys.list({
          name: serviceAccountName,
        })
      );
      return (res.data.keys ?? []).map((key) => ({
        name: key.name ?? "",
        keyType: key.keyType ?? "",
        validAfterTime: key.validAfterTime ?? "",
        validBeforeTime: key.validBeforeTime ?? "",
      }));
    } catch (error) {
      logFetchWarning("iam/service-account-keys", projectId, error);
      return [];
    }
  }

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const accounts: ServiceAccount[] = [];
      let pageToken: string | undefined;

      do {
        const res = await withProjectRetry("iam/service-accounts", projectId, () =>
          iam.projects.serviceAccounts.list({
            name: `projects/${projectId}`,
            pageSize: 100,
            pageToken,
          })
        );

        for (const sa of res.data.accounts ?? []) {
          const name = sa.name ?? "";
          accounts.push({
            name: sa.name ?? "",
            projectId,
            uniqueId: sa.uniqueId ?? "",
            email: sa.email ?? "",
            displayName: sa.displayName ?? sa.email ?? "",
            description: sa.description ?? undefined,
            disabled: sa.disabled ?? false,
            roles: [],
            keys: name ? await getServiceAccountKeys(projectId, name) : [],
            createdAt: undefined, // IAM list API does not return createTime for service accounts
          });
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return accounts;
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
  projectIds: string[],
  forceMock?: boolean
): Promise<ProjectIamPolicy[]> {
  if (useMockData(forceMock)) return getMockProjectPolicies();
  return getRealProjectPolicies(projectIds);
}

export async function getServiceAccounts(
  projectIds: string[],
  forceMock?: boolean
): Promise<ServiceAccount[]> {
  if (useMockData(forceMock)) return getMockServiceAccounts();
  return getRealServiceAccounts(projectIds);
}
