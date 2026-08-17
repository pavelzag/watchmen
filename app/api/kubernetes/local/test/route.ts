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

  const body = (await req.json().catch(() => ({}))) as Partial<LocalKubernetesConfig> & { save?: boolean };
  const current = await getUserLocalKubernetesConfig(session.user.email);
  const config = normalizeLocalKubernetesConfig({ ...current, ...body });
  const status = await getLocalKubernetesStatus(config);

  let savedConfig: LocalKubernetesConfig | null = null;
  if (body.save) {
    savedConfig = await saveUserLocalKubernetesConfig(session.user.email, config);
  }

  return NextResponse.json({
    ok: status.ok,
    config: savedConfig ?? config,
    status,
  }, { status: status.ok || body.save ? 200 : 422 });
}
