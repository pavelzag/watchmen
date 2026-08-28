import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deployClusterWatchmenAgent, getUserCluster } from "@/lib/kubernetes/clusters";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  const origin = process.env.WATCHMEN_BASE_URL ?? req.nextUrl.origin;

  try {
    const result = await deployClusterWatchmenAgent(cluster, origin);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deploy Watchmen eBPF agent.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
