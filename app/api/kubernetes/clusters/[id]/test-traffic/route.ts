import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getClusterTestTrafficStatus,
  getUserCluster,
  setClusterTestTrafficRunning,
} from "@/lib/kubernetes/clusters";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  try {
    const status = await getClusterTestTrafficStatus(cluster);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read test traffic status.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.running !== "boolean") {
    return NextResponse.json({ error: "running must be true or false." }, { status: 400 });
  }

  try {
    const status = await setClusterTestTrafficRunning(cluster, body.running);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update test traffic.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
