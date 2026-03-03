import { getProjectIds, getProjectIdsForOrg, initGoogleAuth, initGoogleAuthFromKey, initUserAuth, discoverUserProjectIds, useMockData } from "./client";
import { getProjectPolicies, getServiceAccounts } from "./iam";
import { getStorageBuckets } from "./storage";
import { getGkeClusters } from "./gke";
import { getVMs } from "./vms";
import { getCloudRunServices } from "./cloudrun";
import { getCloudSqlInstances } from "./cloudsql";
import { getBigQueryDatasets } from "./bigquery";
import { getPubSubTopics } from "./pubsub";
import { getSecrets } from "./secretmanager";
import { getFirewallRules } from "./firewall";
import type { GcpSnapshot } from "./types";

export * from "./types";

/**
 * Fetches the full GCP snapshot across all configured projects.
 * Switch between real and mock via USE_MOCK_DATA=true env var.
 * Pass options.accessToken to use per-user OAuth instead of the service account.
 */
export async function fetchGcpSnapshot(options?: { accessToken?: string; serviceAccountKey?: string }): Promise<GcpSnapshot> {
  const mock = useMockData();

  let projectIds: string[];

  if (mock) {
    projectIds = getProjectIds();
  } else if (options?.serviceAccountKey) {
    initGoogleAuthFromKey(options.serviceAccountKey);
    projectIds = await getProjectIdsForOrg();
  } else if (options?.accessToken) {
    projectIds = await discoverUserProjectIds(options.accessToken);
  } else {
    initGoogleAuth();
    projectIds = await getProjectIdsForOrg();
  }

  if (projectIds.length === 0 && !mock) {
    throw new Error(
      "No GCP projects found. Set GCP_PROJECTS, GCP_ORG_ID, or ensure your account has project access."
    );
  }

  const [
    projects,
    serviceAccounts,
    storageBuckets,
    gkeClusters,
    vms,
    cloudRunServices,
    cloudSqlInstances,
    bigqueryDatasets,
    pubsubTopics,
    secrets,
    firewallRules,
  ] = await Promise.all([
    getProjectPolicies(projectIds),
    getServiceAccounts(projectIds),
    getStorageBuckets(projectIds),
    getGkeClusters(projectIds),
    getVMs(projectIds),
    getCloudRunServices(projectIds),
    getCloudSqlInstances(projectIds),
    getBigQueryDatasets(projectIds),
    getPubSubTopics(projectIds),
    getSecrets(projectIds),
    getFirewallRules(projectIds),
  ]);

  return {
    snapshotId: crypto.randomUUID(),
    projects,
    serviceAccounts,
    storageBuckets,
    gkeClusters,
    vms,
    cloudRunServices,
    cloudSqlInstances,
    bigqueryDatasets,
    pubsubTopics,
    secrets,
    firewallRules,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Returns all unique human users across all projects.
 */
export function extractUsers(snapshot: GcpSnapshot): string[] {
  const users = new Set<string>();
  for (const project of snapshot.projects) {
    for (const binding of project.bindings) {
      for (const member of binding.members) {
        if (member.startsWith("user:")) users.add(member.slice(5));
      }
    }
  }
  return Array.from(users).sort();
}

/**
 * Returns all unique service account emails across all projects.
 */
export function extractServiceAccountEmails(snapshot: GcpSnapshot): string[] {
  return snapshot.serviceAccounts.map((sa) => sa.email);
}
