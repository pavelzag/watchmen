import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    clusterName?: string;
    projectId?: string;
    location?: string;
    nodeName?: string;
    agentSecret?: string;
    agentVersion?: string;
    kernelVersion?: string;
  };

  if (!body.clusterName || !body.nodeName || !body.agentSecret) {
    return NextResponse.json({ error: "clusterName, nodeName, and agentSecret are required." }, { status: 400 });
  }

  await ensureAgentInstallTables();

  const secretHash = createHash("sha256").update(body.agentSecret).digest("hex");

  const agentId = body.nodeName;

  // Clean up any stale entries from old registration formats (e.g. pod-name-based IDs)
  await sql`
    DELETE FROM agent_hosts
    WHERE provider = 'k8s'
      AND metadata->>'clusterName' = ${body.clusterName}
      AND id ILIKE 'k8s-%'
  `;

  await sql`
    INSERT INTO agent_hosts (id, user_email, provider, project_id, zone, instance_id, instance_name, hostname, agent_version, kernel_version, status, secret_hash, metadata)
    VALUES (${agentId}, 'system', 'k8s', ${body.projectId ?? ""}, ${body.location ?? ""}, ${body.nodeName}, ${body.nodeName}, ${body.nodeName}, ${body.agentVersion ?? ""}, ${body.kernelVersion ?? ""}, 'registered', ${secretHash}, ${JSON.stringify({ clusterName: body.clusterName })}::jsonb)
    ON CONFLICT (id) DO UPDATE
    SET user_email = 'system',
        provider = 'k8s',
        project_id = ${body.projectId ?? ""},
        zone = ${body.location ?? ""},
        instance_id = ${body.nodeName},
        instance_name = ${body.nodeName},
        hostname = ${body.nodeName},
        agent_version = ${body.agentVersion ?? ""},
        kernel_version = ${body.kernelVersion ?? ""},
        status = 'registered',
        secret_hash = ${secretHash},
        metadata = ${JSON.stringify({ clusterName: body.clusterName })}::jsonb,
        last_seen_at = NOW()
  `;

  return NextResponse.json({ ok: true, agentId });
}
