export interface IamBinding {
  role: string;
  members: string[];
}

export interface ProjectIamPolicy {
  projectId: string;
  projectName: string;
  bindings: IamBinding[];
}

export interface ServiceAccountKey {
  name: string;
  keyType: string;
  validAfterTime: string;
  validBeforeTime: string;
}

export interface ServiceAccount {
  name: string;
  projectId: string;
  uniqueId: string;
  email: string;
  displayName: string;
  description?: string;
  disabled: boolean;
  roles: string[];
  keys: ServiceAccountKey[];
  createdAt?: string;
}

export interface StorageBucket {
  name: string;
  projectId: string;
  location: string;
  storageClass: string;
  iamPolicy: { bindings: IamBinding[] };
}

export interface GkeCluster {
  name: string;
  projectId: string;
  location: string;
  locationType: "regional" | "zonal";
  status: string;
  currentMasterVersion: string;
  nodeCount: number;
  iamPolicy: { bindings: IamBinding[] };
}

export interface VM {
  name: string;
  projectId: string;
  zone: string;
  machineType: string;
  status: string;
  internalIp: string;
  externalIp?: string | null;
  serviceAccount?: string | null;
  tags?: string[];
  createdAt?: string;
}

export interface CloudRunService {
  name: string;
  projectId: string;
  region: string;
  url?: string;
  status: string;
  serviceAccount?: string;
  iamPolicy: { bindings: IamBinding[] };
}

export interface CloudSqlInstance {
  name: string;
  projectId: string;
  region: string;
  databaseVersion: string;
  tier: string;
  state: string;
  publicIp?: string;
}

export interface BigQueryDataset {
  datasetId: string;
  projectId: string;
  location: string;
  iamPolicy: { bindings: IamBinding[] };
}

export interface PubSubTopic {
  name: string;
  projectId: string;
  iamPolicy: { bindings: IamBinding[] };
}

export interface Secret {
  name: string;
  projectId: string;
  createTime?: string;
  replicationPolicy: string;
  iamPolicy: { bindings: IamBinding[] };
}

export interface FirewallAllowed {
  IPProtocol: string;
  ports?: string[];
}

export interface FirewallRule {
  name: string;
  projectId: string;
  network: string;
  direction: "INGRESS" | "EGRESS";
  priority: number;
  sourceRanges?: string[];
  targetTags?: string[];
  allowed: FirewallAllowed[];
  disabled: boolean;
}

export type SecurityFindingSeverity = "critical" | "high" | "medium" | "low";

export interface SecurityFinding {
  id: string;
  severity: SecurityFindingSeverity;
  title: string;
  description: string;
  resourceName: string;
  projectId: string;
  resourceType: string;
  remediationHint?: string;
}

export interface GcpSnapshot {
  snapshotId: string;
  projects: ProjectIamPolicy[];
  serviceAccounts: ServiceAccount[];
  storageBuckets: StorageBucket[];
  gkeClusters: GkeCluster[];
  vms: VM[];
  cloudRunServices: CloudRunService[];
  cloudSqlInstances: CloudSqlInstance[];
  bigqueryDatasets: BigQueryDataset[];
  pubsubTopics: PubSubTopic[];
  secrets: Secret[];
  firewallRules: FirewallRule[];
  fetchedAt: string;
}
