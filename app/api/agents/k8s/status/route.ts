import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const clusterName = req.nextUrl.searchParams.get("cluster") ?? "";

  await ensureAgentInstallTables();

  if (clusterName) {
    const hosts = await sql`
      SELECT DISTINCT ON (instance_name) id, instance_name, hostname, status, agent_version, kernel_version, last_seen_at, metadata
      FROM agent_hosts
      WHERE provider = 'k8s' AND metadata->>'clusterName' = ${clusterName}
      ORDER BY instance_name, last_seen_at DESC
    `;
    const healthyCount = hosts.rows.filter((h: any) => h.status === "healthy").length;
    return NextResponse.json({ cluster: clusterName, hosts: hosts.rows, nodeCount: hosts.rows.length, healthyCount });
  }

  const clusters = await sql`
    SELECT
      metadata->>'clusterName' AS cluster_name,
      COUNT(DISTINCT instance_name) AS node_count,
      COUNT(DISTINCT CASE WHEN status = 'healthy' THEN instance_name END) AS healthy_count
    FROM agent_hosts
    WHERE provider = 'k8s' AND metadata->>'clusterName' IS NOT NULL
    GROUP BY metadata->>'clusterName'
    ORDER BY metadata->>'clusterName'
  `;

  return NextResponse.json({ clusters: clusters.rows });
}
