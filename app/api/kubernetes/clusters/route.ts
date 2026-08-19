import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUserClusters, createUserCluster } from "@/lib/kubernetes/clusters";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clusters = await listUserClusters(session.user.email);
  const safe = clusters.map((c) => ({ ...c, kubeconfigContent: undefined }));
  return NextResponse.json({ clusters: safe });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
    kubeconfigPath?: string;
    context?: string;
    namespace?: string;
    kubeconfigContent?: string;
    kubeconfigFilename?: string;
  };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Cluster name is required." }, { status: 400 });
  try {
    const cluster = await createUserCluster(session.user.email, {
      name,
      enabled: body.enabled,
      kubeconfigPath: body.kubeconfigPath,
      context: body.context,
      namespace: body.namespace,
      kubeconfigContent: body.kubeconfigContent,
      kubeconfigFilename: body.kubeconfigFilename,
    });
    const safe = { ...cluster, kubeconfigContent: undefined };
    return NextResponse.json({ cluster: safe }, { status: 201 });
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    const msg = err?.message ?? "Failed to create cluster.";
    const code = err?.code;
    const status = msg.includes("already exists") ? 409 : 422;
    return NextResponse.json({ error: msg, code: code ?? (msg.toLowerCase().includes("unreachable") ? "unreachable" : undefined) }, { status });
  }
}
