import type { GcpSnapshot } from "@/lib/gcp/types";

const MAX_SNAPSHOTS = 10;
const KEY = "watchmen_snapshots";

export interface StoredSnapshot {
  snapshotId: string;
  fetchedAt: string;
  data: GcpSnapshot;
}

export interface SnapshotDiff {
  added: {
    projects: string[];
    serviceAccounts: string[];
    storageBuckets: string[];
    gkeClusters: string[];
    vms: string[];
    cloudRunServices: string[];
    cloudSqlInstances: string[];
    pubsubTopics: string[];
    secrets: string[];
    firewallRules: string[];
  };
  removed: {
    projects: string[];
    serviceAccounts: string[];
    storageBuckets: string[];
    gkeClusters: string[];
    vms: string[];
    cloudRunServices: string[];
    cloudSqlInstances: string[];
    pubsubTopics: string[];
    secrets: string[];
    firewallRules: string[];
  };
}

function diffSets(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((x) => !beforeSet.has(x)),
    removed: before.filter((x) => !afterSet.has(x)),
  };
}

export function saveSnapshot(snap: GcpSnapshot): void {
  if (typeof window === "undefined") return;
  const existing = getSnapshots();
  const entry: StoredSnapshot = {
    snapshotId: snap.snapshotId,
    fetchedAt: snap.fetchedAt,
    data: snap,
  };
  const updated = [entry, ...existing].slice(0, MAX_SNAPSHOTS);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // localStorage quota exceeded or unavailable
  }
}

export function getSnapshots(): StoredSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredSnapshot[];
  } catch {
    return [];
  }
}

export function diffSnapshots(a: GcpSnapshot, b: GcpSnapshot): SnapshotDiff {
  const projectsDiff = diffSets(
    a.projects.map((p) => p.projectId),
    b.projects.map((p) => p.projectId)
  );
  const saDiff = diffSets(
    a.serviceAccounts.map((s) => s.email),
    b.serviceAccounts.map((s) => s.email)
  );
  const bucketDiff = diffSets(
    a.storageBuckets.map((b) => b.name),
    b.storageBuckets.map((b) => b.name)
  );
  const clusterDiff = diffSets(
    a.gkeClusters.map((c) => `${c.projectId}/${c.name}`),
    b.gkeClusters.map((c) => `${c.projectId}/${c.name}`)
  );
  const vmDiff = diffSets(
    a.vms.map((v) => `${v.projectId}/${v.name}`),
    b.vms.map((v) => `${v.projectId}/${v.name}`)
  );
  const runDiff = diffSets(
    a.cloudRunServices.map((s) => `${s.projectId}/${s.name}`),
    b.cloudRunServices.map((s) => `${s.projectId}/${s.name}`)
  );
  const sqlDiff = diffSets(
    a.cloudSqlInstances.map((i) => `${i.projectId}/${i.name}`),
    b.cloudSqlInstances.map((i) => `${i.projectId}/${i.name}`)
  );
  const topicDiff = diffSets(
    a.pubsubTopics.map((t) => t.name),
    b.pubsubTopics.map((t) => t.name)
  );
  const secretDiff = diffSets(
    a.secrets.map((s) => s.name),
    b.secrets.map((s) => s.name)
  );
  const fwDiff = diffSets(
    a.firewallRules.map((r) => `${r.projectId}/${r.name}`),
    b.firewallRules.map((r) => `${r.projectId}/${r.name}`)
  );

  return {
    added: {
      projects: projectsDiff.added,
      serviceAccounts: saDiff.added,
      storageBuckets: bucketDiff.added,
      gkeClusters: clusterDiff.added,
      vms: vmDiff.added,
      cloudRunServices: runDiff.added,
      cloudSqlInstances: sqlDiff.added,
      pubsubTopics: topicDiff.added,
      secrets: secretDiff.added,
      firewallRules: fwDiff.added,
    },
    removed: {
      projects: projectsDiff.removed,
      serviceAccounts: saDiff.removed,
      storageBuckets: bucketDiff.removed,
      gkeClusters: clusterDiff.removed,
      vms: vmDiff.removed,
      cloudRunServices: runDiff.removed,
      cloudSqlInstances: sqlDiff.removed,
      pubsubTopics: topicDiff.removed,
      secrets: secretDiff.removed,
      firewallRules: fwDiff.removed,
    },
  };
}
