import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCluster, getClusterStatus, updateUserCluster } from "@/lib/kubernetes/clusters";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await getUserCluster(session.user.email, id);
  if (!existing) return NextResponse.json({ error: "Cluster not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    enabled?: boolean;
    kubeconfigPath?: string;
    context?: string;
    namespace?: string;
    kubeconfigContent?: string;
    kubeconfigFilename?: string;
    save?: boolean;
  };

  // Build preview config (merge existing + body overrides for test)
  const preview: typeof existing = {
    ...existing,
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled,
    kubeconfigPath: body.kubeconfigPath !== undefined ? String(body.kubeconfigPath) : existing.kubeconfigPath,
    context: body.context !== undefined ? String(body.context) : existing.context,
    namespace: body.namespace !== undefined ? String(body.namespace) : existing.namespace,
    kubeconfigContent: body.kubeconfigContent !== undefined ? body.kubeconfigContent : existing.kubeconfigContent,
    kubeconfigFilename: body.kubeconfigFilename !== undefined ? body.kubeconfigFilename : existing.kubeconfigFilename,
  };

  const status = await getClusterStatus(preview);

  if (body.save) {
    try {
      const saved = await updateUserCluster(session.user.email, id, {
        name: preview.name,
        enabled: preview.enabled,
        kubeconfigPath: preview.kubeconfigPath,
        context: preview.context,
        namespace: preview.namespace,
        // only update kubeconfig if body explicitly sent it
        ...(body.kubeconfigContent !== undefined ? { kubeconfigContent: body.kubeconfigContent, kubeconfigFilename: body.kubeconfigFilename } : {}),
      });
      const savedStatus = await getClusterStatus(saved);
      const safe = { ...saved, kubeconfigContent: undefined };
      return NextResponse.json({ ok: savedStatus.ok, cluster: safe, status: savedStatus, hasKubeconfig: savedStatus.hasKubeconfig, kubeconfigFilename: savedStatus.kubeconfigFilename }, { status: savedStatus.ok ? 200 : 422 });
    } catch (e: unknown) {
      const err = e as { message?: string };
      return NextResponse.json({ ok: false, error: err?.message ?? "Failed to save.", status }, { status: 422 });
    }
  }

  return NextResponse.json({ ok: status.ok, cluster: { ...preview, kubeconfigContent: undefined }, status, hasKubeconfig: status.hasKubeconfig, kubeconfigFilename: status.kubeconfigFilename }, { status: status.ok ? 200 : 422 });
}
