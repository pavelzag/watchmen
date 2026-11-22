import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning, withProjectRetry } from "./client";
import type { CloudRunJob, CloudRunService } from "./types";

async function getMockCloudRunServices(): Promise<CloudRunService[]> {
  const data = await import("@/fixtures/cloud-run.json");
  return data.default as CloudRunService[];
}

async function getRealCloudRunServices(projectIds: string[]): Promise<CloudRunService[]> {
  initGoogleAuth();
  const run = google.run("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await withProjectRetry("cloudrun", projectId, () =>
        run.projects.locations.services.list({
          parent: `projects/${projectId}/locations/-`,
        })
      );
      const services: CloudRunService[] = [];
      for (const svc of res.data.items ?? []) {
        const nameParts = (svc.metadata?.name ?? "").split("/");
        const svcName = nameParts[nameParts.length - 1] ?? svc.metadata?.name ?? "";
        const region = svc.metadata?.labels?.["cloud.googleapis.com/location"] ?? "";

        // Fetch IAM policy for this service so pathsPublicCloudRunSa can detect allUsers bindings
        let iamBindings: { role: string; members: string[] }[] = [];
        if (svcName && region) {
          try {
            const iamRes = await run.projects.locations.services.getIamPolicy({
              resource: `projects/${projectId}/locations/${region}/services/${svcName}`,
            });
            iamBindings = (iamRes.data.bindings ?? []).map((b) => ({
              role: b.role ?? "",
              members: b.members ?? [],
            }));
          } catch {
            // IAM fetch failure is non-fatal — service is included without policy
          }
        }

        const rawEnv = svc.spec?.template?.spec?.containers?.[0]?.env ?? [];
        const secretEnvVars = rawEnv
          .filter((e) => e.valueFrom?.secretKeyRef?.name)
          .map((e) => `${e.name}:${e.valueFrom?.secretKeyRef?.name}`);
        const vpcEgress = svc.spec?.template?.metadata?.annotations?.["run.googleapis.com/vpc-access-egress"] ?? undefined;

        services.push({
          name: svcName,
          projectId,
          region,
          url: svc.status?.url ?? undefined,
          status: svc.status?.conditions?.[0]?.status === "True" ? "ACTIVE" : "INACTIVE",
          serviceAccount: svc.spec?.template?.spec?.serviceAccountName ?? undefined,
          iamPolicy: { bindings: iamBindings },
          envVars: Object.fromEntries(
            rawEnv
              .filter((e) => e.name != null && e.value !== undefined)
              .map((e) => [e.name as string, e.value ?? ""] as [string, string])
          ),
          secretEnvVars: secretEnvVars.length > 0 ? secretEnvVars : undefined,
          vpcEgress,
        });
      }
      return services;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<CloudRunService[]> => {
      if (r.status === "rejected") logFetchWarning("cloudrun", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

async function getRealCloudRunJobs(projectIds: string[]): Promise<CloudRunJob[]> {
  initGoogleAuth();
  const runV2 = google.run("v2");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await withProjectRetry("cloudrun-jobs", projectId, () =>
        runV2.projects.locations.jobs.list({
          parent: `projects/${projectId}/locations/-`,
        })
      );
      const jobs: CloudRunJob[] = [];
      for (const job of res.data.jobs ?? []) {
        const fullName = job.name ?? "";
        const match = fullName.match(/^projects\/[^/]+\/locations\/([^/]+)\/jobs\/([^/]+)$/);
        const region = match?.[1] ?? "";
        const jobName = match?.[2] ?? (fullName.split("/").pop() || fullName);

        let iamBindings: { role: string; members: string[] }[] = [];
        if (fullName) {
          try {
            const iamRes = await runV2.projects.locations.jobs.getIamPolicy({
              resource: fullName,
            });
            iamBindings = (iamRes.data.bindings ?? []).map((b) => ({
              role: b.role ?? "",
              members: b.members ?? [],
            }));
          } catch {
            // Non-fatal
          }
        }

        const taskTemplate = job.template?.template;
        const container = taskTemplate?.containers?.[0];
        const rawEnv = container?.env ?? [];
        const envVars = Object.fromEntries(
          rawEnv
            .filter((e) => e.name != null && e.value !== undefined && e.value !== null)
            .map((e) => [e.name as string, e.value ?? ""] as [string, string])
        );
        const secretEnvVars = rawEnv
          .filter((e) => e.valueSource?.secretKeyRef?.secret)
          .map((e) => `${e.name}:${e.valueSource?.secretKeyRef?.secret}`);

        jobs.push({
          name: jobName,
          projectId,
          region,
          status: job.terminalCondition?.state ?? (job.reconciling ? "RECONCILING" : "READY"),
          image: container?.image ?? undefined,
          serviceAccount: taskTemplate?.serviceAccount ?? undefined,
          vpcEgress: taskTemplate?.vpcAccess?.egress ?? undefined,
          iamPolicy: { bindings: iamBindings },
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
          secretEnvVars: secretEnvVars.length > 0 ? secretEnvVars : undefined,
          executionCount: job.executionCount ?? undefined,
        });
      }
      return jobs;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<CloudRunJob[]> => {
      if (r.status === "rejected") logFetchWarning("cloudrun", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getCloudRunServices(
  projectIds: string[],
  forceMock?: boolean
): Promise<CloudRunService[]> {
  if (useMockData(forceMock)) return getMockCloudRunServices();
  return getRealCloudRunServices(projectIds);
}

export async function getCloudRunJobs(
  projectIds: string[],
  forceMock?: boolean
): Promise<CloudRunJob[]> {
  if (useMockData(forceMock)) return [];
  return getRealCloudRunJobs(projectIds);
}
