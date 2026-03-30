import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";

export interface GcpAuthFailure {
  timestamp: string;
  principal: string;
  method: string;
  resource: string;
  projectId: string;
  errorCode: string;   // e.g. "PERMISSION_DENIED", "UNAUTHENTICATED"
  statusMessage: string;
  sourceIp?: string;
}

async function getMockAuthFailures(): Promise<GcpAuthFailure[]> {
  const now = Date.now();
  return [
    {
      timestamp: new Date(now - 12 * 60 * 1000).toISOString(),
      principal: "ci-deploy@my-project.iam.gserviceaccount.com",
      method: "google.iam.admin.v1.GetServiceAccount",
      resource: "projects/my-project/serviceAccounts/ci-deploy",
      projectId: "my-project",
      errorCode: "PERMISSION_DENIED",
      statusMessage: "Permission denied on resource project my-project.",
      sourceIp: "35.191.0.1",
    },
    {
      timestamp: new Date(now - 34 * 60 * 1000).toISOString(),
      principal: "unknown",
      method: "google.storage.v1.GetObject",
      resource: "projects/_/buckets/theinsite-scraped-images",
      projectId: "my-project",
      errorCode: "UNAUTHENTICATED",
      statusMessage: "Request is missing required authentication credential.",
      sourceIp: "203.0.113.45",
    },
    {
      timestamp: new Date(now - 58 * 60 * 1000).toISOString(),
      principal: "bob@corp.com",
      method: "google.container.v1.GetCluster",
      resource: "projects/my-project/zones/us-central1-a/clusters/prod",
      projectId: "my-project",
      errorCode: "PERMISSION_DENIED",
      statusMessage: "bob@corp.com does not have container.clusters.get access to the Google Kubernetes Engine cluster.",
      sourceIp: "10.0.0.5",
    },
    {
      timestamp: new Date(now - 75 * 60 * 1000).toISOString(),
      principal: "external@gmail.com",
      method: "google.iam.v1.SetIamPolicy",
      resource: "projects/my-project",
      projectId: "my-project",
      errorCode: "PERMISSION_DENIED",
      statusMessage: "Permission denied on resource project.",
      sourceIp: "198.51.100.22",
    },
    {
      timestamp: new Date(now - 110 * 60 * 1000).toISOString(),
      principal: "ci-deploy@my-project.iam.gserviceaccount.com",
      method: "google.secretmanager.v1.AccessSecretVersion",
      resource: "projects/my-project/secrets/db-password",
      projectId: "my-project",
      errorCode: "PERMISSION_DENIED",
      statusMessage: "Permission denied on resource.",
      sourceIp: "35.191.0.1",
    },
  ];
}

async function getRealAuthFailures(
  projectIds: string[],
  hours: number
): Promise<GcpAuthFailure[]> {
  initGoogleAuth();
  const logging = google.logging("v2");
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const filter = [
    `timestamp >= "${since}"`,
    `protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"`,
    `(protoPayload.status.code=7 OR protoPayload.status.code=16)`,
  ].join(" AND ");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId): Promise<GcpAuthFailure[]> => {
      const res = await logging.entries.list({
        requestBody: {
          resourceNames: [`projects/${projectId}`],
          filter,
          orderBy: "timestamp desc",
          pageSize: 200,
        },
      });

      return (res.data.entries ?? []).map((e: any) => {
        const proto = e.protoPayload ?? {};
        const status = proto.status ?? {};
        const req = proto.requestMetadata ?? {};
        return {
          timestamp: e.timestamp ?? "",
          principal: proto.authenticationInfo?.principalEmail ?? "unknown",
          method: proto.methodName ?? "",
          resource: proto.resourceName ?? "",
          projectId,
          errorCode: status.code === 7 ? "PERMISSION_DENIED" : "UNAUTHENTICATED",
          statusMessage: status.message ?? "",
          sourceIp: req.callerIp,
        };
      });
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<GcpAuthFailure[]> => {
      if (r.status === "rejected") logFetchWarning("cloud-logging auth", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function getGcpAuthFailures(
  projectIds: string[],
  hours: number,
  forceMock?: boolean
): Promise<GcpAuthFailure[]> {
  if (useMockData(forceMock)) return getMockAuthFailures();
  return getRealAuthFailures(projectIds, hours);
}
