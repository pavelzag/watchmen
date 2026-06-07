import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAgentInstallTables } from "@/lib/db";
import { getUserCloudCredentials } from "@/lib/credentials";
import {
  applyInstallJob,
  createInstallJob,
  listAgentHosts,
  listAssignmentReports,
  listInstallJobs,
  markInstallJob,
  type SelectedGcpInstance,
} from "@/lib/agents/gcp-osconfig";

async function resolveGcpAuth(userEmail: string, accessToken?: string) {
  const credentials = await getUserCloudCredentials(userEmail, "gcp");
  if (credentials?.serviceAccountKey) {
    return { serviceAccountKey: credentials.serviceAccountKey };
  }
  if (accessToken) {
    return { accessToken };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureAgentInstallTables();
  const gcpAuth = await resolveGcpAuth(session.user.email, session.accessToken);
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;

  const [jobs, hosts, reports] = await Promise.all([
    listInstallJobs(session.user.email),
    listAgentHosts(session.user.email),
    gcpAuth ? listAssignmentReports({ userEmail: session.user.email, auth: gcpAuth, projectId }) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    jobs,
    hosts,
    reports,
    canAutomate: Boolean(gcpAuth),
    binaryConfigured: Boolean(process.env.WATCHMEN_AGENT_BINARY_URL),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    instances?: SelectedGcpInstance[];
  };
  const instances = body.instances ?? [];
  if (instances.length === 0) {
    return NextResponse.json({ error: "Select at least one VM." }, { status: 400 });
  }

  const gcpAuth = await resolveGcpAuth(session.user.email, session.accessToken);
  if (!gcpAuth) {
    return NextResponse.json({ error: "No writable GCP credentials are available." }, { status: 422 });
  }

  await ensureAgentInstallTables();
  const job = await createInstallJob({
    userEmail: session.user.email,
    instances,
  });

  try {
    const assignmentNames = await applyInstallJob({
      job,
      auth: gcpAuth,
      baseUrl: req.nextUrl.origin,
    });
    return NextResponse.json({
      ok: true,
      job: { ...job, status: "assigned", assignmentNames },
      binaryConfigured: Boolean(process.env.WATCHMEN_AGENT_BINARY_URL),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markInstallJob(job.id, "failed", [], message);
    return NextResponse.json({ error: message, job: { ...job, status: "failed" } }, { status: 500 });
  }
}
