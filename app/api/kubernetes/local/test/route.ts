import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getLocalKubernetesStatus,
  getUserLocalKubernetesConfig,
  normalizeLocalKubernetesConfig,
  saveUserLocalKubernetesConfig,
  type LocalKubernetesConfig,
} from "@/lib/kubernetes/local";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<LocalKubernetesConfig> & { save?: boolean; kubeconfigContent?: string; kubeconfigFilename?: string };
  const current = await getUserLocalKubernetesConfig(session.user.email);
  // If caller sent kubeconfigContent, use it; otherwise preserve existing inline config unless explicitly cleared.
  const merged: Partial<LocalKubernetesConfig> = { ...current, ...body };
  // Only overwrite kubeconfigContent if body actually included the key.
  if (!Object.prototype.hasOwnProperty.call(body, "kubeconfigContent")) {
    merged.kubeconfigContent = current.kubeconfigContent;
    merged.kubeconfigFilename = current.kubeconfigFilename;
  }
  const config = normalizeLocalKubernetesConfig(merged);
  const status = await getLocalKubernetesStatus(config);

  let savedConfig: LocalKubernetesConfig | null = null;
  if (body.save) {
    try {
      savedConfig = await saveUserLocalKubernetesConfig(session.user.email, config);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Failed to save kubeconfig.", status: { ...status, error: e?.message } }, { status: 422 });
    }
  }

  const safeConfig = { ...(savedConfig ?? config), kubeconfigContent: undefined };
  return NextResponse.json({
    ok: status.ok,
    config: safeConfig,
    status,
    hasKubeconfig: status.hasKubeconfig,
    kubeconfigFilename: status.kubeconfigFilename,
  }, { status: status.ok || body.save ? 200 : 422 });
}
