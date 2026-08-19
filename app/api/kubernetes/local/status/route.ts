import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLocalKubernetesStatus, getUserLocalKubernetesConfig } from "@/lib/kubernetes/local";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getUserLocalKubernetesConfig(session.user.email);
  const status = await getLocalKubernetesStatus(config);
  // Never leak kubeconfig content to the client; only metadata.
  const safeConfig = { ...config, kubeconfigContent: undefined };
  return NextResponse.json({
    config: safeConfig,
    status,
    hasKubeconfig: status.hasKubeconfig ?? Boolean(config.kubeconfigContent?.trim()),
    kubeconfigFilename: status.kubeconfigFilename ?? config.kubeconfigFilename,
  });
}
