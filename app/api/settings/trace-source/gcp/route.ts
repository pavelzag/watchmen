import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  DEFAULT_GCP_TRACE_SOURCE_CONFIG,
  generateGcpTraceSourceBundle,
  getDerivedGcpSetupState,
  getUserGcpTraceSourceConfig,
  saveUserGcpTraceSourceConfig,
  validateGcpStreamingPushEndpoint,
  type GcpTraceSourceConfig,
  type TraceSourceMode,
} from "@/lib/trace-source";

function normalizeMode(value: unknown): TraceSourceMode {
  return value === "streaming" ? "streaming" : "polling";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getUserGcpTraceSourceConfig(session.user.email);
  return NextResponse.json({
    config: {
      ...config,
      setupState: getDerivedGcpSetupState(config),
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<GcpTraceSourceConfig>;
  const current = await getUserGcpTraceSourceConfig(session.user.email);

  const next: GcpTraceSourceConfig = {
    ...DEFAULT_GCP_TRACE_SOURCE_CONFIG,
    ...current,
    mode: normalizeMode(body.mode),
    cloud: "gcp",
    projectId: String(body.projectId ?? current.projectId ?? "").trim(),
    region: String(body.region ?? current.region ?? DEFAULT_GCP_TRACE_SOURCE_CONFIG.region).trim() || DEFAULT_GCP_TRACE_SOURCE_CONFIG.region,
    namePrefix: String(body.namePrefix ?? current.namePrefix ?? DEFAULT_GCP_TRACE_SOURCE_CONFIG.namePrefix).trim() || DEFAULT_GCP_TRACE_SOURCE_CONFIG.namePrefix,
    pushEndpoint: String(body.pushEndpoint ?? current.pushEndpoint ?? "").trim(),
    pushAudience: String(body.pushAudience ?? current.pushAudience ?? "").trim(),
    lastCheckedAt: current.lastCheckedAt,
    lastCheckMessage: current.lastCheckMessage,
    setupState: current.setupState,
  };

  if (next.mode === "streaming" && !next.projectId) {
    return NextResponse.json({ error: "projectId is required for streaming mode." }, { status: 400 });
  }
  if (next.mode === "streaming") {
    const pushEndpointError = validateGcpStreamingPushEndpoint(next.pushEndpoint);
    if (pushEndpointError) {
      return NextResponse.json({ error: pushEndpointError }, { status: 400 });
    }
  }

  next.setupState = getDerivedGcpSetupState(next);
  next.lastCheckMessage = next.mode === "polling"
    ? "Using Cloud Logging polling."
    : next.setupState === "terraform_generated"
      ? "Terraform bundle is ready to apply."
      : current.lastCheckMessage;

  await saveUserGcpTraceSourceConfig(session.user.email, next);

  return NextResponse.json({
    ok: true,
    config: next,
    bundle: next.mode === "streaming" ? generateGcpTraceSourceBundle(next) : null,
  });
}
