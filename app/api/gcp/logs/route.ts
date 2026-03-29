/**
 * Generic Cloud Logging endpoint.
 * Supports resource types: k8s_container, cloud_run_revision, gce_instance.
 *
 * Query params:
 *   projectId      (required)
 *   resourceType   k8s_container | cloud_run_revision | gce_instance  (default: k8s_container)
 *   namespace      k8s namespace                                       (default: "watchmen")
 *   container      k8s container name filter                           (optional)
 *   service        Cloud Run service name                              (required for cloud_run_revision)
 *   region         Cloud Run region / GCE zone                         (optional, tightens filter)
 *   instance       GCE instance name                                   (optional)
 *   limit          max entries, capped at 200                          (default: 40)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { initGoogleAuthFromKey, initUserAuth } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId    = searchParams.get("projectId");
  const resourceType = searchParams.get("resourceType") ?? "k8s_container";
  const limit        = Math.min(Number(searchParams.get("limit") ?? "40"), 200);
  const after        = searchParams.get("after") ?? "";
  const before       = searchParams.get("before") ?? "";

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const email = session.user.email;
  const gcpCreds   = await getUserCloudCredentials(email, "gcp");
  const accessToken = session.accessToken;

  if (!gcpCreds && !accessToken) {
    return NextResponse.json({ error: "No GCP credentials configured." }, { status: 422 });
  }

  try {
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (accessToken) {
      initUserAuth(accessToken as string);
    }

    const logging = google.logging("v2");

    // ── Container listing mode ──────────────────────────────────────────────
    if (searchParams.get("mode") === "containers") {
      const namespace = searchParams.get("namespace") ?? "watchmen";
      const res = await logging.entries.list({
        requestBody: {
          resourceNames: [`projects/${projectId}`],
          filter: [
            `resource.type="k8s_container"`,
            `resource.labels.project_id="${projectId}"`,
            `resource.labels.namespace_name="${namespace}"`,
          ].join("\n"),
          orderBy: "timestamp desc",
          pageSize: 100,
        },
      });
      const containers = [...new Set(
        (res.data.entries ?? [])
          .map(e => (e.resource?.labels as any)?.container_name ?? "")
          .filter(Boolean)
      )].sort();
      return NextResponse.json({ containers });
    }

    const filters: string[] = [`resource.type="${resourceType}"`];

    if (resourceType === "k8s_container") {
      const namespace        = searchParams.get("namespace") ?? "watchmen";
      const container        = searchParams.get("container") ?? "";
      const excludeContainer = searchParams.get("excludeContainer") ?? "";
      filters.push(`resource.labels.project_id="${projectId}"`);
      filters.push(`resource.labels.namespace_name="${namespace}"`);
      if (container)        filters.push(`resource.labels.container_name="${container}"`);
      if (excludeContainer) filters.push(`NOT resource.labels.container_name="${excludeContainer}"`);
      filters.push(`(severity="INFO" OR severity="DEFAULT" OR severity="NOTICE" OR severity="WARNING" OR severity="ERROR")`);

    } else if (resourceType === "cloud_run_revision") {
      const service = searchParams.get("service") ?? "";
      const region  = searchParams.get("region") ?? "";
      if (service) filters.push(`resource.labels.service_name="${service}"`);
      if (region)  filters.push(`resource.labels.location="${region}"`);
      // Cloud Run logs include both application logs and request logs (httpRequest field)
      // Don't filter severity so we get httpRequest entries (they have severity DEFAULT)

    } else if (resourceType === "gce_instance") {
      const instance = searchParams.get("instance") ?? "";
      const zone     = searchParams.get("region") ?? ""; // we reuse "region" param for zone
      if (instance) filters.push(`labels."compute.googleapis.com/resource_name"="${instance}"`);
      if (zone)     filters.push(`resource.labels.zone="${zone}"`);
      filters.push(`(severity="INFO" OR severity="DEFAULT" OR severity="NOTICE" OR severity="WARNING" OR severity="ERROR")`);
    }

    if (after)  filters.push(`timestamp >= "${after}"`);
    if (before) filters.push(`timestamp <= "${before}"`);

    const filterStr = filters.join("\n");
    console.log("[api/gcp/logs] filter:", filterStr);

    const res = await logging.entries.list({
      requestBody: {
        resourceNames: [`projects/${projectId}`],
        filter: filterStr,
        orderBy: "timestamp desc",
        pageSize: limit,
      },
    });

    console.log("[api/gcp/logs] entries returned:", res.data.entries?.length ?? 0);
    const entries = (res.data.entries ?? []).map((e) => {
      // Structured httpRequest field — present on Cloud Run request logs and GCE nginx/apache logs
      const hr = e.httpRequest as any;
      const httpRequest = hr ? {
        method:       hr.requestMethod ?? "",
        url:          hr.requestUrl ?? "",
        status:       hr.status ? Number(hr.status) : undefined,
        latency:      hr.latency ?? "",
        remoteIp:     hr.remoteIp ?? "",
        responseSize: hr.responseSize ?? "",
        userAgent:    hr.userAgent ?? "",
      } : undefined;

      // Text message from payload
      const message =
        typeof e.textPayload === "string" ? e.textPayload
        : e.jsonPayload ? JSON.stringify(e.jsonPayload)
        : httpRequest ? "" // httpRequest entries have no separate message
        : "";

      return {
        timestamp:   e.timestamp ?? "",
        severity:    e.severity ?? "DEFAULT",
        message,
        container:   (e.resource?.labels as any)?.container_name ?? "",
        pod:         (e.resource?.labels as any)?.pod_name ?? "",
        revision:    (e.resource?.labels as any)?.revision_name ?? "",
        instanceId:  (e.resource?.labels as any)?.instance_id ?? "",
        httpRequest,
      };
    });

    return NextResponse.json({ entries, count: entries.length, _filter: filterStr });
  } catch (err: any) {
    console.error("[api/gcp/logs]", err);
    return NextResponse.json({ error: err.message ?? "Failed to fetch logs" }, { status: 500 });
  }
}
