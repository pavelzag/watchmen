import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    projectId?: string;
    zone?: string;
    instanceId?: string;
    instanceName?: string;
    hostname?: string;
    agentSecret?: string;
    agentVersion?: string;
    kernelVersion?: string;
    metadata?: Record<string, unknown>;
  };

  const instanceName = body.instanceName?.trim() || body.hostname?.trim() || "";
  const agentSecret = body.agentSecret ?? "";

  if (!instanceName || !agentSecret) {
    return NextResponse.json(
      { error: "instanceName and agentSecret are required." },
      { status: 400 },
    );
  }

  await ensureAgentInstallTables();

  const projectId = body.projectId?.trim() ?? "";
  const zone = body.zone?.trim() ?? "";
  const instanceId = body.instanceId?.trim() || instanceName;
  const hostname = body.hostname?.trim() || instanceName;
  const agentId = body.agentId?.trim() || `vm:${projectId || "default"}:${instanceName}`;
  const secretHash = createHash("sha256").update(agentSecret).digest("hex");
  const metadata = {
    ...(body.metadata ?? {}),
    instanceName,
  };

  await sql`
    INSERT INTO agent_hosts (
      id, user_email, provider, project_id, zone, instance_id, instance_name,
      hostname, agent_version, kernel_version, status, secret_hash, metadata
    )
    VALUES (
      ${agentId},
      'system',
      'gcp_vm',
      ${projectId},
      ${zone},
      ${instanceId},
      ${instanceName},
      ${hostname},
      ${body.agentVersion?.trim() ?? ""},
      ${body.kernelVersion?.trim() ?? ""},
      'registered',
      ${secretHash},
      ${JSON.stringify(metadata)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE
    SET user_email = 'system',
        provider = 'gcp_vm',
        project_id = ${projectId},
        zone = ${zone},
        instance_id = ${instanceId},
        instance_name = ${instanceName},
        hostname = ${hostname},
        agent_version = ${body.agentVersion?.trim() ?? ""},
        kernel_version = ${body.kernelVersion?.trim() ?? ""},
        status = 'registered',
        secret_hash = ${secretHash},
        metadata = ${JSON.stringify(metadata)}::jsonb,
        last_seen_at = NOW()
  `;

  return NextResponse.json({ ok: true, agentId });
}
