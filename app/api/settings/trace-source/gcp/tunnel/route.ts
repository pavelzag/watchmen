import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLocalTunnelStatus, startLocalTunnel, stopLocalTunnel, type TunnelProvider } from "@/lib/local-tunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getLocalTunnelStatus();
  return NextResponse.json({ status });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { provider?: TunnelProvider; port?: number };
  const status = await startLocalTunnel(body.provider, body.port);
  return NextResponse.json({ status }, { status: status.state === "error" ? 422 : 200 });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await stopLocalTunnel();
  return NextResponse.json({ status });
}
