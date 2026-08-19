import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteUserLocalKubeconfig,
  getLocalKubernetesStatus,
  getUserLocalKubernetesConfig,
  parseKubeconfigContexts,
  saveUserLocalKubernetesConfig,
  validateKubeconfigContent,
} from "@/lib/kubernetes/local";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  if (!trimmed) {
    return NextResponse.json({ error: "No kubeconfig content provided." }, { status: 400 });
  }
  if (trimmed.length > 500_000) {
    return NextResponse.json({ error: "Kubeconfig is too large (max 500 KB)." }, { status: 413 });
  }

  const validation = validateKubeconfigContent(trimmed);
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 422 });
  }

  const current = await getUserLocalKubernetesConfig(session.user.email);
  const contexts = parseKubeconfigContexts(trimmed);
  // Auto-select first context if none set or current context not in new file.
  const context = current.context && contexts.some((c) => c.name === current.context) ? current.context : contexts[0]?.name ?? current.context;

  try {
    await saveUserLocalKubernetesConfig(session.user.email, {
      ...current,
      context,
      kubeconfigContent: trimmed,
      kubeconfigFilename,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to save kubeconfig." }, { status: 422 });
  }

  const updated = await getUserLocalKubernetesConfig(session.user.email);
  const status = await getLocalKubernetesStatus(updated);
  return NextResponse.json({
    ok: true,
    contexts,
    status,
    hasKubeconfig: true,
    kubeconfigFilename,
    context,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await deleteUserLocalKubeconfig(session.user.email);
  const config = await getUserLocalKubernetesConfig(session.user.email);
  const status = await getLocalKubernetesStatus(config);
  return NextResponse.json({ ok: true, status, hasKubeconfig: false });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getUserLocalKubernetesConfig(session.user.email);
  const status = await getLocalKubernetesStatus(config);
  let contexts: ReturnType<typeof parseKubeconfigContexts> = [];
  if (config.kubeconfigContent) {
    contexts = parseKubeconfigContexts(config.kubeconfigContent);
  }
  return NextResponse.json({
    hasKubeconfig: status.hasKubeconfig ?? Boolean(config.kubeconfigContent?.trim()),
    kubeconfigFilename: status.kubeconfigFilename ?? config.kubeconfigFilename,
    contexts,
    status,
  });
}
