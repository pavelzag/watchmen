import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, updateUserCluster, deleteUserCluster } from "@/lib/kubernetes/clusters";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  const safe = { ...cluster, kubeconfigContent: undefined };
  return NextResponse.json({ cluster: safe });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
    kubeconfigPath?: string;
    context?: string;
    namespace?: string;
    kubeconfigContent?: string | null;
    kubeconfigFilename?: string;
  };
  try {
    const cluster = await updateUserCluster(session.user.email, id, body);
    const safe = { ...cluster, kubeconfigContent: undefined };
    return NextResponse.json({ cluster: safe });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json({ error: err?.message ?? "Failed to update cluster." }, { status: 422 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteUserCluster(session.user.email, id);
  return NextResponse.json({ ok: true });
}
