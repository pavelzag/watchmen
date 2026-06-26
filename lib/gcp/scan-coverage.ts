import type { GcpScanWarning } from "./types";

export type GcpScanServiceId =
  | "projects"
  | "iam/policies"
  | "iam/service-accounts"
  | "iam/service-account-keys"
  | "storage"
  | "gke"
  | "vms"
  | "firewall"
  | "loadbalancing"
  | "cloudrun"
  | "cloudsql"
  | "bigquery"
  | "pubsub"
  | "secretmanager";

export type GcpScanCapability = {
  service: GcpScanServiceId;
  label: string;
  shows: string;
  api?: string;
  roles: string[];
  dependsOn?: GcpScanServiceId[];
};

export const GCP_SCAN_CAPABILITIES: GcpScanCapability[] = [
  {
    service: "projects",
    label: "Projects",
    shows: "Project metadata and project-level IAM policy context.",
    api: "cloudresourcemanager.googleapis.com",
    roles: ["roles/browser", "roles/viewer"],
  },
  {
    service: "iam/policies",
    label: "Project IAM Policies",
    shows: "Project IAM bindings for users, groups, service accounts, and public principals.",
    api: "cloudresourcemanager.googleapis.com",
    roles: ["roles/iam.securityReviewer"],
  },
  {
    service: "iam/service-accounts",
    label: "Service Accounts",
    shows: "Service account inventory, disabled state, and IAM identity metadata.",
    api: "iam.googleapis.com",
    roles: ["roles/iam.serviceAccountViewer", "roles/iam.securityReviewer"],
  },
  {
    service: "iam/service-account-keys",
    label: "Service Account Keys",
    shows: "User-managed service account keys and key expiration windows.",
    api: "iam.googleapis.com",
    roles: ["roles/iam.serviceAccountViewer"],
    dependsOn: ["iam/service-accounts"],
  },
  {
    service: "storage",
    label: "Cloud Storage",
    shows: "Buckets, bucket metadata, and bucket IAM policies.",
    api: "storage.googleapis.com",
    roles: ["roles/storage.viewer"],
  },
  {
    service: "gke",
    label: "GKE",
    shows: "Clusters, locations, node counts, private-cluster state, and container IAM bindings.",
    api: "container.googleapis.com",
    roles: ["roles/container.viewer", "roles/iam.securityReviewer"],
  },
  {
    service: "vms",
    label: "Compute Engine VMs",
    shows: "VM instances, IP addresses, labels, tags, and attached service accounts.",
    api: "compute.googleapis.com",
    roles: ["roles/compute.viewer"],
  },
  {
    service: "firewall",
    label: "VPC Firewall",
    shows: "Firewall rules, ingress exposure, target tags, allowed protocols, and source ranges.",
    api: "compute.googleapis.com",
    roles: ["roles/compute.viewer"],
  },
  {
    service: "loadbalancing",
    label: "Load Balancing",
    shows: "Global and regional forwarding rules and public load balancer IPs.",
    api: "compute.googleapis.com",
    roles: ["roles/compute.viewer"],
  },
  {
    service: "cloudrun",
    label: "Cloud Run",
    shows: "Services, regions, URLs, runtime service accounts, env var names, and service IAM policies.",
    api: "run.googleapis.com",
    roles: ["roles/run.viewer"],
  },
  {
    service: "cloudsql",
    label: "Cloud SQL",
    shows: "Instances, regions, database versions, public IPs, backups, and SSL settings.",
    api: "sqladmin.googleapis.com",
    roles: ["roles/cloudsql.viewer"],
  },
  {
    service: "bigquery",
    label: "BigQuery",
    shows: "Datasets, locations, and dataset IAM policies.",
    api: "bigquery.googleapis.com",
    roles: ["roles/bigquery.metadataViewer"],
  },
  {
    service: "pubsub",
    label: "Pub/Sub",
    shows: "Topics and topic IAM policies.",
    api: "pubsub.googleapis.com",
    roles: ["roles/pubsub.viewer"],
  },
  {
    service: "secretmanager",
    label: "Secret Manager",
    shows: "Secrets, replication policy, creation time, and secret IAM policies. Secret values are not read.",
    api: "secretmanager.googleapis.com",
    roles: ["roles/secretmanager.viewer"],
  },
];

export function getGcpCapability(service: string): GcpScanCapability | undefined {
  return GCP_SCAN_CAPABILITIES.find((capability) => capability.service === service);
}

export function getGcpRequiredRoles(service: string): string[] {
  return getGcpCapability(service)?.roles ?? [];
}

export function getGcpRequiredApi(service: string): string | undefined {
  return getGcpCapability(service)?.api;
}

export function buildGcpGrantCommands(projectId: string, member: string | undefined, service: string): string[] {
  const roles = getGcpRequiredRoles(service);
  const principal = member?.trim() || "serviceAccount:SERVICE_ACCOUNT_EMAIL";
  return roles.map((role) =>
    `gcloud projects add-iam-policy-binding ${projectId} --member="${principal}" --role="${role}"`
  );
}

export function buildGcpEnableApiCommand(projectId: string, service: string): string | null {
  const api = getGcpRequiredApi(service);
  if (!api) return null;
  return `gcloud services enable ${api} --project=${projectId}`;
}

export function enrichGcpScanWarning(warning: GcpScanWarning): GcpScanWarning {
  return {
    ...warning,
    requiredRoles: warning.requiredRoles ?? getGcpRequiredRoles(warning.service),
    requiredApi: warning.requiredApi ?? getGcpRequiredApi(warning.service),
    grantCommands: warning.grantCommands ?? buildGcpGrantCommands(warning.projectId, warning.principal, warning.service),
    enableApiCommand: warning.enableApiCommand ?? buildGcpEnableApiCommand(warning.projectId, warning.service) ?? undefined,
  };
}
