import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

const AGENT_HEALTH_WINDOW = "5 minutes";

export async function GET(req: NextRequest) {
  const clusterName = req.nextUrl.searchParams.get("cluster") ?? "";

  await ensureAgentInstallTables();

  if (clusterName) {
    const hosts = await sql`
      SELECT DISTINCT ON (instance_name)
        id,
        instance_name,
        hostname,
        CASE WHEN status = 'healthy' AND last_seen_at > NOW() - ${AGENT_HEALTH_WINDOW}::interval THEN 'healthy' ELSE 'stale' END AS status,
        agent_version,
        kernel_version,
        last_seen_at,
        metadata
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
      COUNT(DISTINCT CASE WHEN status = 'healthy' AND last_seen_at > NOW() - ${AGENT_HEALTH_WINDOW}::interval THEN instance_name END) AS healthy_count,
      MAX(last_seen_at) AS last_seen_at
    FROM agent_hosts
    WHERE provider = 'k8s' AND metadata->>'clusterName' IS NOT NULL
    GROUP BY metadata->>'clusterName'
    ORDER BY metadata->>'clusterName'
  `;

  return NextResponse.json({ clusters: clusters.rows });
}
