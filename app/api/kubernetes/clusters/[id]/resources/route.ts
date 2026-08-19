import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, getClusterResources } from "@/lib/kubernetes/clusters";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  const result = await getClusterResources(cluster);
  const statusCode = result.cluster.ok ? 200 : result.cluster.code === "disabled" ? 200 : 422;
  return NextResponse.json(result, { status: statusCode });
}
