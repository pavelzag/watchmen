import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, updateUserCluster, deleteUserClusterKubeconfig } from "@/lib/kubernetes/clusters";
import { validateKubeconfigContent, parseKubeconfigContexts } from "@/lib/kubernetes/local";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await getUserCluster(session.user.email, id);
  if (!existing) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";
  let kubeconfigContent = "";
  let kubeconfigFilename = "kubeconfig.yaml";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const text = form.get("kubeconfig") as string | null;
    if (file && file instanceof File) {
      kubeconfigFilename = file.name || kubeconfigFilename;
      kubeconfigContent = await file.text();
    } else if (text) {
      kubeconfigContent = text;
      kubeconfigFilename = (form.get("filename") as string) || kubeconfigFilename;
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as { kubeconfig?: string; kubeconfigContent?: string; filename?: string; kubeconfigFilename?: string };
    kubeconfigContent = body.kubeconfig ?? body.kubeconfigContent ?? "";
    kubeconfigFilename = body.filename ?? body.kubeconfigFilename ?? kubeconfigFilename;
  }

  const trimmed = kubeconfigContent.trim();
  if (!trimmed) return NextResponse.json({ error: "No kubeconfig content provided." }, { status: 400 });
  if (trimmed.length > 500_000) return NextResponse.json({ error: "Kubeconfig is too large (max 500 KB)." }, { status: 413 });
  const v = validateKubeconfigContent(trimmed);
  if (v) return NextResponse.json({ error: v }, { status: 422 });

  const contexts = parseKubeconfigContexts(trimmed);
  const context = existing.context && contexts.some((c) => c.name === existing.context) ? existing.context : contexts[0]?.name ?? existing.context;

  try {
    await updateUserCluster(session.user.email, id, { kubeconfigContent: trimmed, kubeconfigFilename, context });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json({ error: err?.message ?? "Failed to save kubeconfig." }, { status: 422 });
  }
  const updated = await getUserCluster(session.user.email, id);
  const { getClusterStatus } = await import("@/lib/kubernetes/clusters");
  const status = updated ? await getClusterStatus(updated) : null;
  return NextResponse.json({ ok: true, contexts, status, hasKubeconfig: true, kubeconfigFilename, context });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await getUserCluster(session.user.email, id);
  if (!existing) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  await deleteUserClusterKubeconfig(session.user.email, id);
  const updated = await getUserCluster(session.user.email, id);
  const { getClusterStatus } = await import("@/lib/kubernetes/clusters");
  const status = updated ? await getClusterStatus(updated) : null;
  return NextResponse.json({ ok: true, status, hasKubeconfig: false });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const cluster = await getUserCluster(session.user.email, id);
  if (!cluster) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
  const { getClusterStatus } = await import("@/lib/kubernetes/clusters");
  const status = await getClusterStatus(cluster);
  let contexts: ReturnType<typeof parseKubeconfigContexts> = [];
  if (cluster.kubeconfigContent) contexts = parseKubeconfigContexts(cluster.kubeconfigContent);
  return NextResponse.json({ hasKubeconfig: status.hasKubeconfig, kubeconfigFilename: status.kubeconfigFilename, contexts, status });
}
