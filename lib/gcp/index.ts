import { getProjectIdFromServiceAccountKey, getProjectIds, getProjectIdsForOrg, initGoogleAuth, initGoogleAuthFromKey, initUserAuth, discoverUserProjectIds, useMockData, getGcpScanWarnings, resetGcpScanWarnings } from "./client";
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
import { getLoadBalancers } from "./loadbalancing";
import { extractGcpServiceAccountEmails, extractGcpUsers } from "./principals";
import type { GcpSnapshot } from "./types";
import type { TaskProgressEvent } from "@/lib/tasks/types";

export * from "./types";
export { collectGcpIamBindingScopes, collectGcpUsers } from "./principals";

/**
 * Fetches the full GCP snapshot across all configured projects.
 * Switch between real and mock via USE_MOCK_DATA=true env var.
 * Pass options.accessToken to use per-user OAuth instead of the service account.
 */
function emitProgress(
  onProgress: ((event: TaskProgressEvent) => void) | undefined,
  event: TaskProgressEvent
): void {
  onProgress?.(event);
}

export async function fetchGcpSnapshot(options?: {
  accessToken?: string;
  serviceAccountKey?: string;
  forceMock?: boolean;
  onProgress?: (event: TaskProgressEvent) => void;
}): Promise<GcpSnapshot> {
  const mock = useMockData(options?.forceMock);
  resetGcpScanWarnings();

  let projectIds: string[];

  if (mock) {
    projectIds = getProjectIds();
  } else if (options?.serviceAccountKey) {
    initGoogleAuthFromKey(options.serviceAccountKey);
    const configuredProjectIds = await getProjectIdsForOrg();
    const serviceAccountProjectId = getProjectIdFromServiceAccountKey(options.serviceAccountKey);
    projectIds = configuredProjectIds.length > 0
      ? configuredProjectIds
      : serviceAccountProjectId
        ? [serviceAccountProjectId]
        : [];
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

  emitProgress(options?.onProgress, {
    stage: "discover_projects",
    message: `Resolved ${projectIds.length} GCP project${projectIds.length === 1 ? "" : "s"}`,
    percent: 10,
    metadata: { projectCount: projectIds.length, mock },
  });

  let completedServices = 0;
  const totalServices = 12;
  emitProgress(options?.onProgress, {
    stage: "scan_services",
    message: `Scanning ${totalServices} GCP service areas`,
    completed: 0,
    total: totalServices,
    percent: 15,
  });

  async function runLoader<T>(resource: string, message: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    completedServices += 1;
    emitProgress(options?.onProgress, {
      stage: "scan_services",
      message,
      completed: completedServices,
      total: totalServices,
      percent: 15 + Math.round((completedServices / totalServices) * 70),
      metadata: { resource },
    });
    return result;
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
    loadBalancers,
  ] = await Promise.all([
    runLoader("projects", "Loading IAM project policies", () => getProjectPolicies(projectIds, mock)),
    runLoader("serviceAccounts", "Loading service accounts", () => getServiceAccounts(projectIds, mock)),
    runLoader("storageBuckets", "Loading storage buckets", () => getStorageBuckets(projectIds, mock)),
    runLoader("gkeClusters", "Loading GKE clusters", () => getGkeClusters(projectIds, mock)),
    runLoader("vms", "Loading virtual machines", () => getVMs(projectIds, mock)),
    runLoader("cloudRunServices", "Loading Cloud Run services", () => getCloudRunServices(projectIds, mock)),
    runLoader("cloudSqlInstances", "Loading Cloud SQL instances", () => getCloudSqlInstances(projectIds, mock)),
    runLoader("bigqueryDatasets", "Loading BigQuery datasets", () => getBigQueryDatasets(projectIds, mock)),
    runLoader("pubsubTopics", "Loading Pub/Sub topics", () => getPubSubTopics(projectIds, mock)),
    runLoader("secrets", "Loading secrets", () => getSecrets(projectIds, mock)),
    runLoader("firewallRules", "Loading firewall rules", () => getFirewallRules(projectIds, mock)),
    runLoader("loadBalancers", "Loading load balancers", () => getLoadBalancers(projectIds, mock)),
  ]);

  // Enrich SA roles from project IAM bindings.
  // getRealServiceAccounts returns roles:[] because the list API doesn't
  // include project-level role assignments. Cross-reference here so that
  // attack-path generators (saPrivilege checks) work on real GCP data.
  if (!mock) {
    const saRoleMap = new Map<string, Set<string>>();
    for (const project of projects) {
      for (const binding of project.bindings) {
        for (const member of binding.members) {
          if (member.startsWith("serviceAccount:")) {
            const email = member.slice("serviceAccount:".length);
            if (!saRoleMap.has(email)) saRoleMap.set(email, new Set());
            saRoleMap.get(email)!.add(binding.role);
          }
        }
      }
    }
    for (const sa of serviceAccounts) {
      const roles = saRoleMap.get(sa.email);
      if (roles && roles.size > 0) sa.roles = Array.from(roles);
    }
  }

  emitProgress(options?.onProgress, {
    stage: "finalize_snapshot",
    message: "Finalizing GCP snapshot",
    percent: 95,
    metadata: { projectCount: projectIds.length },
  });

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
    loadBalancers,
    scanWarnings: getGcpScanWarnings(),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Returns all unique human users across all projects.
 */
export function extractUsers(snapshot: GcpSnapshot): string[] {
  return extractGcpUsers(snapshot);
}

/**
 * Returns all unique service account emails across all projects.
 */
export function extractServiceAccountEmails(snapshot: GcpSnapshot): string[] {
  return extractGcpServiceAccountEmails(snapshot);
}
