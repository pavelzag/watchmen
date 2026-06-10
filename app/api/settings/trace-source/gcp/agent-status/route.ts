import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAgentInstallTables, ensureGcpSnapshotTable, sql } from "@/lib/db";
import type { GkeCluster, GcpSnapshot } from "@/lib/gcp/types";

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
  const clusters = snapshot?.gkeClusters ?? [];

  await ensureAgentInstallTables();
  const hostResult = await sql`
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
  `;

  const statusByCluster = new Map<string, {
    nodeCount: number;
    healthyCount: number;
    lastSeenAt: string | null;
  }>();

  for (const row of hostResult.rows) {
    const key = `${row.project_id}/${row.location}/${row.cluster_name}`;
    statusByCluster.set(key, {
      nodeCount: Number(row.node_count ?? 0),
      healthyCount: Number(row.healthy_count ?? 0),
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    });
  }

  const origin = process.env.WATCHMEN_BASE_URL ?? new URL(req.url).origin;
  const clusterStatuses = clusters.map((cluster) => {
    const key = `${cluster.projectId}/${cluster.location}/${cluster.name}`;
    const status = statusByCluster.get(key) ?? { nodeCount: 0, healthyCount: 0, lastSeenAt: null };
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

  return NextResponse.json({ clusters: clusterStatuses });
}
