import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAgentInstallTables, ensureGcpSnapshotTable, sql } from "@/lib/db";
import { getUserCloudCredentials } from "@/lib/credentials";
import { initGoogleAuthForRequest } from "@/lib/gcp/client";
import { getGkeClusters } from "@/lib/gcp/gke";
import { getVMs } from "@/lib/gcp/vms";
import type { GkeCluster, GcpSnapshot, VM } from "@/lib/gcp/types";

const AGENT_HEALTH_WINDOW = "5 minutes";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function manifestUrl(origin: string, cluster: GkeCluster): string {
  const params = new URLSearchParams({
    cluster: cluster.name,
    project: cluster.projectId,
    location: cluster.location,
  });
  return `${origin}/api/agents/k8s/manifest?${params}`;
}

function deployCommand(origin: string, cluster: GkeCluster): string {
  const locationFlag = cluster.locationType === "zonal" ? "--zone" : "--region";
  const url = manifestUrl(origin, cluster);
  return [
    `gcloud container clusters get-credentials ${shellQuote(cluster.name)} ${locationFlag} ${shellQuote(cluster.location)} --project ${shellQuote(cluster.projectId)}`,
    `curl -fsSL ${shellQuote(url)} | kubectl apply -f -`,
    `kubectl -n watchmen rollout status daemonset/watchmen-ebpf-agent`,
  ].join("\n");
}

function vmInstallUrl(origin: string, vm: VM): string {
  const params = new URLSearchParams({
    project: vm.projectId,
    zone: vm.zone,
    instance: vm.name,
  });
  return `${origin}/api/agents/vm/install?${params}`;
}

function vmDeployCommand(origin: string, vm: VM): string {
  const url = vmInstallUrl(origin, vm);
  return `WATCHMEN_AGENT_SECRET="$(openssl rand -hex 32)" curl -fsSL ${shellQuote(url)} | sudo -E bash`;
}

async function getLiveClustersAndVms(
  email: string,
  accessToken: unknown,
  snapshotClusters: GkeCluster[],
  snapshotVms: VM[],
  snapshot: GcpSnapshot | undefined,
): Promise<{ clusters: GkeCluster[]; vms: VM[] }> {
  const projectIds = [
    ...new Set([
      ...(snapshot?.projects ?? []).map((project) => project.projectId),
      ...snapshotClusters.map((cluster) => cluster.projectId),
      ...snapshotVms.map((vm) => vm.projectId),
    ].filter(Boolean)),
  ];
  if (projectIds.length === 0) return { clusters: snapshotClusters, vms: snapshotVms };

  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  if (!initGoogleAuthForRequest({
    serviceAccountKey: gcpCreds?.serviceAccountKey as string | undefined,
    accessToken,
  })) {
    return { clusters: snapshotClusters, vms: snapshotVms };
  }

  const [clustersRes, vmsRes] = await Promise.allSettled([
    getGkeClusters(projectIds, false),
    getVMs(projectIds, false),
  ]);

  if (clustersRes.status === "rejected") {
    console.warn("[api/settings/trace-source/gcp/agent-status] live GKE refresh failed; using stored snapshot", clustersRes.reason);
  }
  if (vmsRes.status === "rejected") {
    console.warn("[api/settings/trace-source/gcp/agent-status] live VM refresh failed; using stored snapshot", vmsRes.reason);
  }

  return {
    clusters: clustersRes.status === "fulfilled" ? clustersRes.value : snapshotClusters,
    vms: vmsRes.status === "fulfilled" ? vmsRes.value : snapshotVms,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureGcpSnapshotTable();
  const snapshotResult = await sql`
    SELECT snapshot
    FROM user_snapshots
    WHERE user_email = ${email}
  `;

  const snapshot = snapshotResult.rows[0]?.snapshot as GcpSnapshot | undefined;
  const snapshotClusters = snapshot?.gkeClusters ?? [];
  const snapshotVms = snapshot?.vms ?? [];
  const { clusters, vms } = await getLiveClustersAndVms(email, session.accessToken, snapshotClusters, snapshotVms, snapshot);

  await ensureAgentInstallTables();
  const [hostResult, vmHostResult] = await Promise.all([
    sql`
      SELECT
        metadata->>'clusterName' AS cluster_name,
        project_id,
        zone AS location,
        COUNT(DISTINCT instance_name) AS node_count,
        COUNT(DISTINCT CASE WHEN status = 'healthy' AND last_seen_at > NOW() - ${AGENT_HEALTH_WINDOW}::interval THEN instance_name END) AS healthy_count,
        MAX(last_seen_at) AS last_seen_at
      FROM agent_hosts
      WHERE provider = 'k8s'
        AND metadata->>'clusterName' IS NOT NULL
      GROUP BY metadata->>'clusterName', project_id, zone
    `,
    sql`
      SELECT
        id,
        project_id,
        zone,
        instance_name,
        status,
        last_seen_at,
        (status = 'healthy' AND last_seen_at > NOW() - ${AGENT_HEALTH_WINDOW}::interval) AS healthy
      FROM agent_hosts
      WHERE provider = 'gcp_vm'
    `,
  ]);

  const statusByCluster = new Map<string, {
    nodeCount: number;
    healthyCount: number;
    lastSeenAt: string | null;
  }>();
  const statusByClusterName = new Map<string, {
    nodeCount: number;
    healthyCount: number;
    lastSeenAt: string | null;
  }>();

  for (const row of hostResult.rows) {
    const status = {
      nodeCount: Number(row.node_count ?? 0),
      healthyCount: Number(row.healthy_count ?? 0),
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    };
    const key = `${row.project_id}/${row.location}/${row.cluster_name}`;
    statusByCluster.set(key, status);
    if (!statusByClusterName.has(row.cluster_name) || status.healthyCount > 0) {
      statusByClusterName.set(row.cluster_name, status);
    }
  }

  const origin = process.env.WATCHMEN_BASE_URL ?? new URL(req.url).origin;
  const clusterStatuses = clusters.map((cluster) => {
    const key = `${cluster.projectId}/${cluster.location}/${cluster.name}`;
    const status = statusByCluster.get(key)
      ?? statusByClusterName.get(cluster.name)
      ?? { nodeCount: 0, healthyCount: 0, lastSeenAt: null };
    return {
      clusterName: cluster.name,
      projectId: cluster.projectId,
      location: cluster.location,
      locationType: cluster.locationType,
      snapshotNodeCount: cluster.nodeCount,
      nodeCount: status.nodeCount,
      healthyCount: status.healthyCount,
      installed: status.nodeCount > 0,
      healthy: status.healthyCount > 0,
      lastSeenAt: status.lastSeenAt,
      manifestUrl: manifestUrl(origin, cluster),
      deployCommand: deployCommand(origin, cluster),
    };
  });

  const vmByKey = new Map<string, { installed: boolean; healthy: boolean; lastSeenAt: string | null }>();
  for (const row of vmHostResult.rows) {
    const key = `${row.project_id}/${row.zone}/${row.instance_name}`;
    vmByKey.set(key, {
      installed: true,
      healthy: Boolean(row.healthy),
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    });
  }

  const vmStatuses = vms.map((vm) => {
    const key = `${vm.projectId}/${vm.zone}/${vm.name}`;
    const status = vmByKey.get(key) ?? { installed: false, healthy: false, lastSeenAt: null };
    return {
      instanceName: vm.name,
      projectId: vm.projectId,
      zone: vm.zone,
      status: vm.status,
      installed: status.installed,
      healthy: status.healthy,
      lastSeenAt: status.lastSeenAt,
      installUrl: vmInstallUrl(origin, vm),
      deployCommand: vmDeployCommand(origin, vm),
    };
  });

  return NextResponse.json({ clusters: clusterStatuses, vms: vmStatuses });
}
