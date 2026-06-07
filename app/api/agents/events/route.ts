import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  const agentId = req.headers.get("x-watchmen-agent-id") ?? "";
  const agentSecret = req.headers.get("x-watchmen-agent-secret") ?? "";
  if (!agentId || !agentSecret) {
    return NextResponse.json({ error: "Missing agent credentials." }, { status: 401 });
  }

  const secretHash = createHash("sha256").update(agentSecret).digest("hex");
  await ensureAgentInstallTables();

  const host = await sql`
    SELECT id, provider, project_id FROM agent_hosts
    WHERE id = ${agentId} AND secret_hash = ${secretHash}
    LIMIT 1
  `;
  if (host.rows.length === 0) {
    return NextResponse.json({ error: "Invalid agent credentials." }, { status: 403 });
  }

  const event = await req.json();
  await sql`
    INSERT INTO agent_events (agent_id, provider, project_id, event)
    VALUES (${agentId}, ${host.rows[0].provider}, ${host.rows[0].project_id}, ${JSON.stringify(event)}::jsonb)
  `;
  await sql`
    UPDATE agent_hosts SET last_seen_at = NOW(), status = 'healthy'
    WHERE id = ${agentId}
  `;

  return NextResponse.json({ ok: true });
}

