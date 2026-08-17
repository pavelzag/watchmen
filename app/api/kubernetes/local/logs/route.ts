import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLocalKubernetesLogs, getUserLocalKubernetesConfig } from "@/lib/kubernetes/local";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const config = await getUserLocalKubernetesConfig(session.user.email);
  try {
    const entries = await getLocalKubernetesLogs(config, {
      namespace: searchParams.get("namespace") ?? undefined,
      pod: searchParams.get("pod") ?? undefined,
      deployment: searchParams.get("deployment") ?? searchParams.get("app") ?? undefined,
      app: searchParams.get("app") ?? undefined,
      container: searchParams.get("container") ?? undefined,
      after: searchParams.get("after") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      limit: Number(searchParams.get("limit") ?? 100),
    });
    return NextResponse.json({ entries, count: entries.length });
  } catch (error: any) {
    const message = error?.message ?? "Failed to fetch Kubernetes logs.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
