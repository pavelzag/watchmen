import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cluster = req.nextUrl.searchParams.get("cluster") ?? "";
  const after = req.nextUrl.searchParams.get("after") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);
  const email = session.user.email;

  await ensureAgentInstallTables();

  let events;
  if (cluster && after) {
    events = await sql`
      SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, COALESCE(e.cluster_name, h.metadata->>'clusterName') AS cluster_name
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE h.provider = 'k8s'
        AND COALESCE(e.cluster_name, h.metadata->>'clusterName') = ${cluster}
        AND e.received_at > ${after}::timestamptz
        AND (h.user_email = ${email} OR h.user_email = 'system')
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (cluster) {
    events = await sql`
      SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, COALESCE(e.cluster_name, h.metadata->>'clusterName') AS cluster_name
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE h.provider = 'k8s'
        AND COALESCE(e.cluster_name, h.metadata->>'clusterName') = ${cluster}
        AND (h.user_email = ${email} OR h.user_email = 'system')
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (after) {
    events = await sql`
      SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, COALESCE(e.cluster_name, h.metadata->>'clusterName') AS cluster_name
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE e.received_at > ${after}::timestamptz
        AND (h.user_email = ${email} OR h.user_email = 'system')
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    events = await sql`
      SELECT e.id, e.agent_id, e.provider, e.project_id, e.event, e.received_at, COALESCE(e.cluster_name, h.metadata->>'clusterName') AS cluster_name
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE h.user_email = ${email}
         OR h.user_email = 'system'
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return NextResponse.json({ events: events.rows });
}
