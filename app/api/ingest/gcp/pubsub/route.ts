import { NextRequest, NextResponse } from "next/server";
import { publishLiveTraceEvent, type LiveTraceIngressEvent } from "@/lib/live-trace-bus";
import { listUsersForGcpStreamingProject, saveUserGcpTraceSourceConfig } from "@/lib/trace-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PubsubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GcpLogHttpRequest {
  requestMethod?: string;
  requestUrl?: string;
  status?: number | string;
  latency?: string;
  remoteIp?: string;
  userAgent?: string;
}

interface GcpLogEntry {
  timestamp?: string;
  logName?: string;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  labels?: Record<string, string>;
  httpRequest?: GcpLogHttpRequest;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
}

function decodePubsubData(data: string | undefined): unknown {
  if (!data) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractProjectId(entry: GcpLogEntry): string {
  return entry.resource?.labels?.project_id
    ?? entry.logName?.split("/")[1]
    ?? "";
}

function extractPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function normalizeGcpLogEntry(entry: GcpLogEntry, messageId: string | undefined): LiveTraceIngressEvent | null {
  const projectId = extractProjectId(entry);
  const resourceType = entry.resource?.type;
  const resourceLabels = entry.resource?.labels ?? {};
  const httpRequest = entry.httpRequest;
  const timestamp = entry.timestamp ?? new Date().toISOString();

  if (!projectId || !resourceType) return null;

  if (resourceType === "cloud_run_revision" && resourceLabels.service_name) {
    return {
      id: messageId ?? `gcp:cloudrun:${projectId}:${resourceLabels.service_name}:${timestamp}`,
      cloud: "gcp",
      kind: "cloudrun",
      projectId,
      region: resourceLabels.location,
      resourceName: resourceLabels.service_name,
      timestamp,
      method: httpRequest?.requestMethod,
      path: extractPath(httpRequest?.requestUrl),
      status: httpRequest?.status ? Number(httpRequest.status) : undefined,
      latency: httpRequest?.latency,
      remoteIp: httpRequest?.remoteIp,
      userAgent: httpRequest?.userAgent,
      count: 1,
    };
  }

  if (resourceType === "gce_instance") {
    const instanceName = entry.labels?.["compute.googleapis.com/resource_name"] ?? resourceLabels.instance_id;
    if (!instanceName) return null;
    return {
      id: messageId ?? `gcp:vm:${projectId}:${instanceName}:${timestamp}`,
      cloud: "gcp",
      kind: "vm",
      projectId,
      region: resourceLabels.zone,
      resourceName: instanceName,
      timestamp,
      method: httpRequest?.requestMethod,
      path: extractPath(httpRequest?.requestUrl),
      status: httpRequest?.status ? Number(httpRequest.status) : undefined,
      latency: httpRequest?.latency,
      remoteIp: httpRequest?.remoteIp,
      userAgent: httpRequest?.userAgent,
      count: 1,
    };
  }

  if (resourceType === "k8s_container" && resourceLabels.container_name) {
    return {
      id: messageId ?? `gcp:gke:${projectId}:${resourceLabels.container_name}:${timestamp}`,
      cloud: "gcp",
      kind: "gke",
      projectId,
      region: resourceLabels.location,
      resourceName: resourceLabels.cluster_name ?? resourceLabels.namespace_name ?? "gke",
      container: resourceLabels.container_name,
      timestamp,
      method: httpRequest?.requestMethod,
      path: extractPath(httpRequest?.requestUrl),
      status: httpRequest?.status ? Number(httpRequest.status) : undefined,
      latency: httpRequest?.latency,
      remoteIp: httpRequest?.remoteIp,
      userAgent: httpRequest?.userAgent,
      count: 1,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PubsubPushEnvelope;
  const payload = decodePubsubData(body.message?.data);
  const entry = payload as GcpLogEntry | null;

  if (!entry) {
    return NextResponse.json({ ok: true, ignored: true, reason: "No decodable Pub/Sub payload." });
  }

  const event = normalizeGcpLogEntry(entry, body.message?.messageId);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true, reason: "Unsupported or unmatchable log entry." });
  }

  const recipients = await listUsersForGcpStreamingProject(event.projectId);
  if (recipients.length === 0) {
    console.warn("[api/ingest/gcp/pubsub] no recipients matched incoming event", {
      projectId: event.projectId,
      kind: event.kind,
      resourceName: event.resourceName,
      eventId: event.id,
    });
  }
  await Promise.all(recipients.map(async ({ userEmail, config }) => {
    publishLiveTraceEvent(userEmail, event);
    if (config.setupState !== "receiving_events") {
      await saveUserGcpTraceSourceConfig(userEmail, {
        ...config,
        setupState: "receiving_events",
        lastCheckedAt: new Date().toISOString(),
        lastCheckMessage: "Streaming events received from Pub/Sub.",
      });
    }
  }));

  return NextResponse.json({
    ok: true,
    deliveredTo: recipients.length,
    eventId: event.id,
  });
}
