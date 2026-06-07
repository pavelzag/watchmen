import { createHash, randomBytes, randomUUID } from "crypto";
import { google, osconfig_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { sql } from "@/lib/db";
import type { VM } from "@/lib/gcp/types";

export const WATCHMEN_AGENT_LABEL = "watchmen-agent";
export const WATCHMEN_AGENT_LABEL_VALUE = "enabled";
export const WATCHMEN_INSTALL_JOB_LABEL = "watchmen-install-job";

export type SelectedGcpInstance = {
  projectId: string;
  zone: string;
  name: string;
  id?: string;
};

export type AgentInstallJob = {
  id: string;
  userEmail: string;
  provider: "gcp";
  projectId: string;
  status: string;
  selectedInstances: SelectedGcpInstance[];
  assignmentNames: string[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type AgentHost = {
  id: string;
  provider: "gcp";
  projectId: string;
  zone: string;
  instanceId: string;
  instanceName: string;
  hostname: string;
  agentVersion: string;
  kernelVersion: string;
  status: string;
  lastSeenAt: string;
};

export type AgentInstallReport = {
  projectId: string;
  zone: string;
  instance: string;
  assignmentId: string;
  complianceState: string;
  reason?: string;
  updatedAt?: string;
};

type AuthInput = {
  accessToken?: string;
  serviceAccountKey?: string;
};

function authClient(input: AuthInput) {
  if (input.serviceAccountKey) {
    const credentials = JSON.parse(input.serviceAccountKey);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  if (input.accessToken) {
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth.setCredentials({ access_token: input.accessToken });
    return oauth;
  }

  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
}

export function assignmentIdForUser(userEmail: string): string {
  const hash = createHash("sha256").update(userEmail).digest("hex").slice(0, 10);
  return `watchmen-agent-${hash}`;
}

function normalizeZone(zone: string): string {
  return zone.includes("/") ? zone.split("/").pop() ?? zone : zone;
}

function shortJobId(jobId: string): string {
  return jobId.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 63);
}

function originNoSlash(origin: string): string {
  return origin.replace(/\/$/, "");
}

function buildAssignment(
  jobId: string,
  userEmail: string,
  installScriptUrl: string
): osconfig_v1.Schema$OSPolicyAssignment {
  const command = [
    "set -eu",
    `curl -fsSL ${JSON.stringify(installScriptUrl)} | /bin/sh`,
    "exit 100",
  ].join("\n");

  return {
    description: "Installs and keeps the Watchmen eBPF agent running on labeled Linux VMs.",
    instanceFilter: {
      inclusionLabels: [
        {
          labels: {
            [WATCHMEN_AGENT_LABEL]: WATCHMEN_AGENT_LABEL_VALUE,
          },
        },
      ],
      inventories: [
        { osShortName: "ubuntu" },
        { osShortName: "debian" },
        { osShortName: "rhel" },
        { osShortName: "centos" },
        { osShortName: "rocky" },
      ],
    },
    osPolicies: [
      {
        id: "watchmen-agent-policy",
        mode: "ENFORCEMENT",
        allowNoResourceGroupMatch: true,
        resourceGroups: [
          {
            resources: [
              {
                id: "ensure-watchmen-agent",
                exec: {
                  validate: {
                    interpreter: "SHELL",
                    script:
                      "if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet watchmen-ebpf-agent; then exit 100; fi\nexit 101",
                  },
                  enforce: {
                    interpreter: "SHELL",
                    script: command,
                    outputFilePath: "/var/log/watchmen-agent-install.log",
                  },
                },
              },
            ],
          },
        ],
      },
    ],
    rollout: {
      disruptionBudget: { fixed: 5 },
      minWaitDuration: "60s",
    },
  };
}

export async function createInstallJob(params: {
  userEmail: string;
  instances: SelectedGcpInstance[];
}): Promise<AgentInstallJob> {
  const projectIds = new Set(params.instances.map((vm) => vm.projectId));
  if (projectIds.size !== 1) {
    throw new Error("Select VMs from a single GCP project for one install job.");
  }
  const id = randomUUID();
  const projectId = params.instances[0]?.projectId ?? "";
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const result = await sql`
    INSERT INTO agent_install_jobs (
      id, user_email, provider, project_id, status,
      selected_instances, assignment_names, expires_at
    )
    VALUES (
      ${id}, ${params.userEmail}, 'gcp', ${projectId}, 'pending',
      ${JSON.stringify(params.instances)}::jsonb, '[]'::jsonb, ${expiresAt}
    )
    RETURNING *
  `;
  return mapJob(result.rows[0]);
}

export async function markInstallJob(
  jobId: string,
  status: string,
  assignmentNames: string[] = [],
  error?: string
): Promise<void> {
  await sql`
    UPDATE agent_install_jobs
    SET status = ${status},
        assignment_names = ${JSON.stringify(assignmentNames)}::jsonb,
        error = ${error ?? null},
        updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

export async function getInstallJob(jobId: string): Promise<AgentInstallJob | null> {
  const result = await sql`SELECT * FROM agent_install_jobs WHERE id = ${jobId}`;
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function listInstallJobs(userEmail: string): Promise<AgentInstallJob[]> {
  const result = await sql`
    SELECT * FROM agent_install_jobs
    WHERE user_email = ${userEmail} AND provider = 'gcp'
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  return result.rows.map(mapJob);
}

export async function listAgentHosts(userEmail: string): Promise<AgentHost[]> {
  const result = await sql`
    SELECT * FROM agent_hosts
    WHERE user_email = ${userEmail} AND provider = 'gcp'
    ORDER BY last_seen_at DESC
  `;
  return result.rows.map((row) => ({
    id: row.id,
    provider: "gcp",
    projectId: row.project_id,
    zone: row.zone,
    instanceId: row.instance_id,
    instanceName: row.instance_name,
    hostname: row.hostname,
    agentVersion: row.agent_version,
    kernelVersion: row.kernel_version,
    status: row.status,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function applyInstallJob(params: {
  job: AgentInstallJob;
  auth: AuthInput;
  baseUrl: string;
}): Promise<string[]> {
  const auth = authClient(params.auth);
  const compute = google.compute({ version: "v1", auth });
  const osconfig = google.osconfig({ version: "v1", auth });
  const assignmentId = assignmentIdForUser(params.job.userEmail);
  const assignmentNames: string[] = [];

  const byZone = new Map<string, SelectedGcpInstance[]>();
  for (const instance of params.job.selectedInstances) {
    const zone = normalizeZone(instance.zone);
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push({ ...instance, zone });
  }

  for (const [zone, instances] of byZone) {
    for (const instance of instances) {
      const current = await compute.instances.get({
        project: instance.projectId,
        zone,
        instance: instance.name,
      });
      const labels = {
        ...(current.data.labels ?? {}),
        [WATCHMEN_AGENT_LABEL]: WATCHMEN_AGENT_LABEL_VALUE,
          [WATCHMEN_INSTALL_JOB_LABEL]: shortJobId(params.job.id),
      };
      await compute.instances.setLabels({
        project: instance.projectId,
        zone,
        instance: instance.name,
        requestId: randomUUID(),
        requestBody: {
          labels,
          labelFingerprint: current.data.labelFingerprint ?? undefined,
        },
      });
    }

    const installScriptUrl = `${originNoSlash(params.baseUrl)}/api/agents/gcp/install-script?job=${encodeURIComponent(params.job.id)}`;
    const parent = `projects/${params.job.projectId}/locations/${zone}`;
    const name = `${parent}/osPolicyAssignments/${assignmentId}`;
    const requestBody = buildAssignment(params.job.id, params.job.userEmail, installScriptUrl);

    await osconfig.projects.locations.osPolicyAssignments.patch({
      name,
      allowMissing: true,
      updateMask: "description,instance_filter,os_policies,rollout",
      requestId: randomUUID(),
      requestBody,
    });
    assignmentNames.push(name);
  }

  await markInstallJob(params.job.id, "assigned", assignmentNames);
  return assignmentNames;
}

export async function listAssignmentReports(params: {
  userEmail: string;
  auth: AuthInput;
  projectId?: string;
}): Promise<AgentInstallReport[]> {
  const auth = authClient(params.auth);
  const osconfig = google.osconfig({ version: "v1", auth });
  const jobs = (await listInstallJobs(params.userEmail)).filter((job) =>
    params.projectId ? job.projectId === params.projectId : true
  );
  const reports: AgentInstallReport[] = [];

  for (const job of jobs) {
    const assignmentId = assignmentIdForUser(job.userEmail);
    const zones = [...new Set(job.selectedInstances.map((vm) => normalizeZone(vm.zone)))];
    for (const zone of zones) {
      try {
        const parent = `projects/${job.projectId}/locations/${zone}/instances/-/osPolicyAssignments/${assignmentId}/reports`;
        const res = await osconfig.projects.locations.instances.osPolicyAssignments.reports.list({
          parent,
          pageSize: 100,
        });
        for (const report of res.data.osPolicyAssignmentReports ?? []) {
          const compliance = report.osPolicyCompliances?.[0];
          reports.push({
            projectId: job.projectId,
            zone,
            instance: report.instance ?? "",
            assignmentId,
            complianceState: compliance?.complianceState ?? "UNKNOWN",
            reason: compliance?.complianceStateReason ?? undefined,
            updatedAt: report.updateTime ?? undefined,
          });
        }
      } catch (err) {
        console.info("[gcp-agent-install] report lookup skipped:", err instanceof Error ? err.message : String(err));
      }
    }
  }

  return reports;
}

export async function registerGcpAgent(params: {
  job: AgentInstallJob;
  identityToken: string;
  audience: string;
  hostname?: string;
  agentVersion?: string;
  kernelVersion?: string;
}): Promise<{ agentId: string; agentSecret: string }> {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: params.identityToken,
    audience: params.audience,
  });
  const payload = ticket.getPayload() as
    | (Record<string, unknown> & {
        google?: {
          compute_engine?: {
            project_id?: string;
            zone?: string;
            instance_id?: string;
            instance_name?: string;
          };
        };
      })
    | undefined;

  const compute = payload?.google?.compute_engine;
  const projectId = compute?.project_id ?? "";
  const zone = normalizeZone(compute?.zone ?? "");
  const instanceId = compute?.instance_id ?? "";
  const instanceName = compute?.instance_name ?? "";

  const allowed = params.job.selectedInstances.some((vm) => {
    const sameProject = vm.projectId === projectId;
    const sameZone = normalizeZone(vm.zone) === zone;
    const sameInstance = (vm.id && vm.id === instanceId) || vm.name === instanceName;
    return sameProject && sameZone && sameInstance;
  });
  if (!allowed) {
    throw new Error("Instance identity is not included in this install job.");
  }

  const agentId = `agt_${randomBytes(12).toString("hex")}`;
  const agentSecret = randomBytes(32).toString("base64url");
  const secretHash = createHash("sha256").update(agentSecret).digest("hex");

  const result = await sql`
    INSERT INTO agent_hosts (
      id, user_email, provider, project_id, zone, instance_id, instance_name,
      hostname, agent_version, kernel_version, status, secret_hash, metadata,
      registered_at, last_seen_at
    )
    VALUES (
      ${agentId}, ${params.job.userEmail}, 'gcp', ${projectId}, ${zone}, ${instanceId}, ${instanceName},
      ${params.hostname ?? ""}, ${params.agentVersion ?? ""}, ${params.kernelVersion ?? ""},
      'registered', ${secretHash}, ${JSON.stringify({ jobId: params.job.id })}::jsonb,
      NOW(), NOW()
    )
    ON CONFLICT (user_email, provider, project_id, zone, instance_id) DO UPDATE
      SET hostname = EXCLUDED.hostname,
          agent_version = EXCLUDED.agent_version,
          kernel_version = EXCLUDED.kernel_version,
          status = 'registered',
          secret_hash = EXCLUDED.secret_hash,
          metadata = EXCLUDED.metadata,
          last_seen_at = NOW()
    RETURNING id
  `;

  await markInstallJob(params.job.id, "registered", params.job.assignmentNames);

  return { agentId: result.rows[0].id, agentSecret };
}

function mapJob(row: Record<string, unknown>): AgentInstallJob {
  return {
    id: row.id as string,
    userEmail: row.user_email as string,
    provider: "gcp",
    projectId: row.project_id as string,
    status: row.status as string,
    selectedInstances: row.selected_instances as SelectedGcpInstance[],
    assignmentNames: row.assignment_names as string[],
    error: row.error as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiresAt: row.expires_at as string,
  };
}

export function vmAgentStatus(vm: VM, hosts: AgentHost[], reports: AgentInstallReport[]) {
  const host = hosts.find(
    (h) =>
      h.projectId === vm.projectId &&
      normalizeZone(h.zone) === normalizeZone(vm.zone) &&
      ((vm.id && h.instanceId === vm.id) || h.instanceName === vm.name)
  );
  if (host) return { state: "registered", host };

  const report = reports.find(
    (r) =>
      r.projectId === vm.projectId &&
      normalizeZone(r.zone) === normalizeZone(vm.zone) &&
      (r.instance === vm.name || r.instance === vm.id)
  );
  if (report) return { state: report.complianceState.toLowerCase(), report };

  if (vm.labels?.[WATCHMEN_AGENT_LABEL] === WATCHMEN_AGENT_LABEL_VALUE) {
    return { state: "assigned" };
  }

  return { state: "not_installed" };
}
