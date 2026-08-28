import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateWatchmenAgentManifest } from "@/lib/agents/k8s-manifest";
import { getClusterStatus, getUserCluster } from "@/lib/kubernetes/clusters";

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "local-kubernetes";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  const status = await getClusterStatus(cluster);
  const clusterName = status.clusterName || cluster.name || "local-kubernetes";
  const origin = process.env.WATCHMEN_BASE_URL ?? req.nextUrl.origin;
  const namespace = cluster.namespace || "watchmen";

  const yaml = generateWatchmenAgentManifest({
    clusterName,
    projectId: "self-managed",
    location: cluster.context || "local",
    namespace,
    origin,
    binaryUrl: "",
    binaryBaseUrl: `${origin}/api/agents/k8s/binary`,
  });

  return new NextResponse(yaml, {
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Content-Disposition": `attachment; filename="watchmen-agent-${safeFilename(clusterName)}.yaml"`,
    },
  });
}
