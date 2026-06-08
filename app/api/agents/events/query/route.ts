import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const cluster = req.nextUrl.searchParams.get("cluster") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);

  await ensureAgentInstallTables();

  let events;
  if (cluster) {
    events = await sql`
      SELECT e.id, e.agent_id, e.event, e.received_at
      FROM agent_events e
      JOIN agent_hosts h ON h.id = e.agent_id
      WHERE h.provider = 'k8s' AND h.metadata->>'clusterName' = ${cluster}
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    events = await sql`
      SELECT e.id, e.agent_id, e.event, e.received_at
      FROM agent_events e
      ORDER BY e.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return NextResponse.json({ events: events.rows });
}
