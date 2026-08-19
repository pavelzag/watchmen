import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, getClusterLogs } from "@/lib/kubernetes/clusters";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  const { searchParams } = new URL(req.url);
  try {
    const entries = await getClusterLogs(cluster, {
      namespace: searchParams.get("namespace") ?? undefined,
      pod: searchParams.get("pod") ?? undefined,
      deployment: searchParams.get("deployment") ?? searchParams.get("app") ?? undefined,
      app: searchParams.get("app") ?? undefined,
      container: searchParams.get("container") ?? undefined,
      after: searchParams.get("after") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      limit: Number(searchParams.get("limit") ?? 100),
    });
    return NextResponse.json({ entries, count: entries.length });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json({ error: err?.message ?? "Failed to fetch logs." }, { status: 422 });
  }
}
