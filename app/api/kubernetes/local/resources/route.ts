import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLocalKubernetesResources, getUserLocalKubernetesConfig } from "@/lib/kubernetes/local";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getUserLocalKubernetesConfig(session.user.email);
  const result = await getLocalKubernetesResources(config);
  const status = result.cluster.ok ? 200 : result.cluster.code === "disabled" ? 200 : 422;
  return NextResponse.json(result, { status });
}
