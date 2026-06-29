import type { GcpSnapshot, IamBinding } from "./types";

type BindingScope = {
  projectId: string;
  resourceType: string;
  resourceName: string;
  bindings: IamBinding[];
};

export type GcpPrincipalAccess = {
  email: string;
  projects: string[];
  roles: string[];
  resourceTypes: string[];
};

function addScope(scopes: BindingScope[], projectId: string, resourceType: string, resourceName: string, bindings?: IamBinding[]) {
  if (!bindings || bindings.length === 0) return;
  scopes.push({ projectId, resourceType, resourceName, bindings });
}

export function collectGcpIamBindingScopes(snapshot: GcpSnapshot): BindingScope[] {
  const scopes: BindingScope[] = [];

  for (const project of snapshot.projects) {
    addScope(scopes, project.projectId, "project", project.projectName || project.projectId, project.bindings);
  }
  for (const bucket of snapshot.storageBuckets) {
    addScope(scopes, bucket.projectId, "storageBucket", bucket.name, bucket.iamPolicy.bindings);
  }
  for (const cluster of snapshot.gkeClusters) {
    addScope(scopes, cluster.projectId, "gkeCluster", cluster.name, cluster.iamPolicy.bindings);
  }
  for (const service of snapshot.cloudRunServices) {
    addScope(scopes, service.projectId, "cloudRunService", service.name, service.iamPolicy.bindings);
  }
  for (const dataset of snapshot.bigqueryDatasets) {
    addScope(scopes, dataset.projectId, "bigQueryDataset", dataset.datasetId, dataset.iamPolicy.bindings);
  }
  for (const topic of snapshot.pubsubTopics) {
    addScope(scopes, topic.projectId, "pubSubTopic", topic.name, topic.iamPolicy.bindings);
  }
  for (const secret of snapshot.secrets) {
    addScope(scopes, secret.projectId, "secret", secret.name, secret.iamPolicy.bindings);
  }

  return scopes;
}

function memberEmail(member: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (member.startsWith(prefix)) {
      const email = member.slice(prefix.length).split("?")[0];
      return email || null;
    }
  }
  return null;
}

export function collectGcpUsers(snapshot: GcpSnapshot): GcpPrincipalAccess[] {
  const users = new Map<string, { projects: Set<string>; roles: Set<string>; resourceTypes: Set<string> }>();

  for (const scope of collectGcpIamBindingScopes(snapshot)) {
    for (const binding of scope.bindings) {
      for (const member of binding.members) {
        const email = memberEmail(member, ["user:", "deleted:user:"]);
        if (!email) continue;
        if (!users.has(email)) {
          users.set(email, { projects: new Set(), roles: new Set(), resourceTypes: new Set() });
        }
        const row = users.get(email)!;
        row.projects.add(scope.projectId);
        row.roles.add(binding.role);
        row.resourceTypes.add(scope.resourceType);
      }
    }
  }

  return Array.from(users.entries())
    .map(([email, access]) => ({
      email,
      projects: Array.from(access.projects).sort(),
      roles: Array.from(access.roles).sort(),
      resourceTypes: Array.from(access.resourceTypes).sort(),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function extractGcpUsers(snapshot: GcpSnapshot): string[] {
  return collectGcpUsers(snapshot).map((user) => user.email);
}

export function collectGcpServiceAccountReferences(snapshot: GcpSnapshot): GcpPrincipalAccess[] {
  const accounts = new Map<string, { projects: Set<string>; roles: Set<string>; resourceTypes: Set<string> }>();

  function add(email: string | undefined | null, projectId: string, resourceType: string, role?: string) {
    if (!email) return;
    if (!accounts.has(email)) {
      accounts.set(email, { projects: new Set(), roles: new Set(), resourceTypes: new Set() });
    }
    const account = accounts.get(email)!;
    account.projects.add(projectId);
    account.resourceTypes.add(resourceType);
    if (role) account.roles.add(role);
  }

  for (const sa of snapshot.serviceAccounts) {
    add(sa.email, sa.projectId, "serviceAccount");
    for (const role of sa.roles) add(sa.email, sa.projectId, "serviceAccount", role);
  }

  for (const scope of collectGcpIamBindingScopes(snapshot)) {
    for (const binding of scope.bindings) {
      for (const member of binding.members) {
        const email = memberEmail(member, ["serviceAccount:", "deleted:serviceAccount:"]);
        add(email, scope.projectId, scope.resourceType, binding.role);
      }
    }
  }

  for (const vm of snapshot.vms) {
    add(vm.serviceAccount, vm.projectId, "vm");
  }
  for (const service of snapshot.cloudRunServices) {
    add(service.serviceAccount, service.projectId, "cloudRunService");
  }

  return Array.from(accounts.entries())
    .map(([email, access]) => ({
      email,
      projects: Array.from(access.projects).sort(),
      roles: Array.from(access.roles).sort(),
      resourceTypes: Array.from(access.resourceTypes).sort(),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function extractGcpServiceAccountEmails(snapshot: GcpSnapshot): string[] {
  return collectGcpServiceAccountReferences(snapshot).map((account) => account.email);
}
