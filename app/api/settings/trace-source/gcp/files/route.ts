import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateGcpTraceSourceBundle, getPublicHttpsPushEndpoint, getUserGcpTraceSourceConfig } from "@/lib/trace-source";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getUserGcpTraceSourceConfig(session.user.email);
  if (config.mode !== "streaming") {
    return NextResponse.json({ error: "Switch to streaming mode to generate Terraform." }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const defaultPushEndpoint = getPublicHttpsPushEndpoint(origin);
  const normalizedConfig = {
    ...config,
    pushEndpoint: config.pushEndpoint.trim() || defaultPushEndpoint,
    pushAudience: config.pushAudience.trim() || (config.pushEndpoint.trim() || defaultPushEndpoint),
  };

  return NextResponse.json({
    config: normalizedConfig,
    bundle: generateGcpTraceSourceBundle(normalizedConfig),
  });
}
