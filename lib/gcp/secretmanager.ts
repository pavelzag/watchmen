import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { Secret } from "./types";

async function getMockSecrets(): Promise<Secret[]> {
  const data = await import("@/fixtures/secrets.json");
  return data.default as Secret[];
}

async function getRealSecrets(projectIds: string[]): Promise<Secret[]> {
  initGoogleAuth();
  const sm = google.secretmanager("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await sm.projects.secrets.list({
        parent: `projects/${projectId}`,
      });
      const secrets: Secret[] = [];

      for (const secret of res.data.secrets ?? []) {
        let bindings: { role: string; members: string[] }[] = [];
        try {
          const iamRes = await sm.projects.secrets.getIamPolicy({
            resource: secret.name ?? "",
          });
          bindings = (iamRes.data.bindings ?? []).map((b) => ({
            role: b.role ?? "",
            members: b.members ?? [],
          }));
        } catch {
          // ignore IAM fetch errors
        }

        const replication = secret.replication?.automatic
          ? "AUTOMATIC"
          : secret.replication?.userManaged
          ? "USER_MANAGED"
          : "AUTOMATIC";

        secrets.push({
          name: secret.name ?? "",
          projectId,
          createTime: secret.createTime ?? undefined,
          replicationPolicy: replication,
          iamPolicy: { bindings },
        });
      }
      return secrets;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<Secret[]> => {
      if (r.status === "rejected") logFetchWarning("secretmanager", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getSecrets(projectIds: string[]): Promise<Secret[]> {
  if (useMockData()) return getMockSecrets();
  return getRealSecrets(projectIds);
}
