import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo-mode";
import { getLocalKubernetesResources, getUserLocalKubernetesConfig } from "@/lib/kubernetes/local";
import { getDemoKubernetesResources } from "@/lib/mock/runtime-events";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isDemoUser || isDemoMode()) {
    return NextResponse.json(getDemoKubernetesResources("demo-minikube"));
  }

  const config = await getUserLocalKubernetesConfig(session.user.email);
  const result = await getLocalKubernetesResources(config);
  const status = result.cluster.ok ? 200 : result.cluster.code === "disabled" ? 200 : 422;
  return NextResponse.json(result, { status });
}
