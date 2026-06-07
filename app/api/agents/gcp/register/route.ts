import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables } from "@/lib/db";
import { getInstallJob, registerGcpAgent } from "@/lib/agents/gcp-osconfig";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    jobId?: string;
    identityToken?: string;
    hostname?: string;
    agentVersion?: string;
    kernelVersion?: string;
  };

  if (!body.jobId || !body.identityToken) {
    return NextResponse.json({ error: "jobId and identityToken are required." }, { status: 400 });
  }

  await ensureAgentInstallTables();
  const job = await getInstallJob(body.jobId);
  if (!job) return NextResponse.json({ error: "Unknown install job." }, { status: 404 });
  if (new Date(job.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "Install job expired." }, { status: 410 });
  }

  try {
    const result = await registerGcpAgent({
      job,
      identityToken: body.identityToken,
      audience: req.nextUrl.origin + req.nextUrl.pathname,
      hostname: body.hostname,
      agentVersion: body.agentVersion,
      kernelVersion: body.kernelVersion,
    });
    return NextResponse.json({
      ...result,
      endpoint: req.nextUrl.origin,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

