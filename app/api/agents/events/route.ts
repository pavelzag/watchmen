import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  const agentId = req.headers.get("x-watchmen-agent-id") ?? "";
  const agentSecret = req.headers.get("x-watchmen-agent-secret") ?? "";
  if (!agentId || !agentSecret) {
    return NextResponse.json({ error: "Missing agent credentials." }, { status: 401 });
  }

  const secretHash = createHash("sha256").update(agentSecret).digest("hex");

  const host = await sql`
    SELECT id, provider, project_id, metadata->>'clusterName' AS cluster_name FROM agent_hosts
    WHERE id = ${agentId} AND secret_hash = ${secretHash}
    LIMIT 1
  `;
  if (host.rows.length === 0) {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 403 });
  }

  const event = await req.json();
  const status = typeof event?.status === "string" && /^\d{3}$/.test(event.status)
    ? Number(event.status)
    : typeof event?.status === "number"
      ? event.status
      : null;
  await sql`
    INSERT INTO agent_events (agent_id, provider, project_id, event, event_type, http_status, http_method, http_path, cluster_name)
    VALUES (
      ${agentId},
      ${host.rows[0].provider},
      ${host.rows[0].project_id},
      ${JSON.stringify(event)}::jsonb,
      ${event?.type ?? null},
      ${status},
      ${event?.method ?? null},
      ${event?.path ?? null},
      ${host.rows[0].cluster_name ?? null}
    )
  `;
  await sql`
    UPDATE agent_hosts SET last_seen_at = NOW(), status = 'healthy'
    WHERE id = ${agentId}
  `;

  return NextResponse.json({ ok: true });
}
