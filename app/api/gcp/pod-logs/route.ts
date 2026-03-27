import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { initGoogleAuthFromKey, initUserAuth } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const namespace = searchParams.get("namespace") ?? "watchmen";
  const containerName = searchParams.get("container") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const email = session.user.email;
  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  const accessToken = session.accessToken;

  if (!gcpCreds && !accessToken) {
    return NextResponse.json({ error: "No GCP credentials configured." }, { status: 422 });
  }

  try {
    if (gcpCreds?.serviceAccountKey) {
      initGoogleAuthFromKey(gcpCreds.serviceAccountKey as string);
    } else if (accessToken) {
      initUserAuth(accessToken as string);
    }

    const logging = google.logging("v2");

    // Build filter: k8s container logs in the given namespace
    const filters = [
      `resource.type="k8s_container"`,
      `resource.labels.project_id="${projectId}"`,
      `resource.labels.namespace_name="${namespace}"`,
    ];
    if (containerName) {
      filters.push(`resource.labels.container_name="${containerName}"`);
    }
    // Only show request-looking log lines — severity INFO or DEFAULT
    filters.push(`(severity="INFO" OR severity="DEFAULT" OR severity="NOTICE")`);

    const res = await logging.entries.list({
      requestBody: {
        resourceNames: [`projects/${projectId}`],
        filter: filters.join("\n"),
        orderBy: "timestamp desc",
        pageSize: limit,
      },
    });

    const entries = (res.data.entries ?? []).map((e) => ({
      timestamp: e.timestamp,
      severity: e.severity ?? "DEFAULT",
      message:
        typeof e.textPayload === "string"
          ? e.textPayload
          : e.jsonPayload
          ? JSON.stringify(e.jsonPayload)
          : "",
      container: (e.resource?.labels as any)?.container_name ?? "",
      pod: (e.resource?.labels as any)?.pod_name ?? "",
    }));

    return NextResponse.json({ entries, count: entries.length });
  } catch (err: any) {
    console.error("[api/gcp/pod-logs]", err);
    return NextResponse.json({ error: err.message ?? "Failed to fetch logs" }, { status: 500 });
  }
}
