import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, getClusterStatus } from "@/lib/kubernetes/clusters";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  const status = await getClusterStatus(cluster);
  const safe = { ...cluster, kubeconfigContent: undefined };
  return NextResponse.json({ cluster: safe, status, hasKubeconfig: status.hasKubeconfig, kubeconfigFilename: status.kubeconfigFilename });
}
