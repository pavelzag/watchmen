import { NextRequest, NextResponse } from "next/server";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { auth } from "@/lib/auth";
import { getAwsClientOptions, type AwsCredentials } from "@/lib/aws/client";
import { getUserCloudCredentials } from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeLogGroupValue(value: string): string {
  return value.replace(/[^A-Za-z0-9-_/.]/g, "");
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toIso(value?: number): string {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const region = searchParams.get("region") || "us-east-1";
  const functionName = sanitizeLogGroupValue(searchParams.get("functionName") || searchParams.get("service") || "");
  const after = searchParams.get("after") || "";
  const limit = Math.min(Number(searchParams.get("limit") || "100"), 200);

  if (!functionName) {
    return NextResponse.json({ error: "functionName is required" }, { status: 400 });
  }

  const logGroupName = `/aws/lambda/${functionName}`;
  const afterMs = after ? Date.parse(after) : Date.now() - 5 * 60_000;
  const startTime = Number.isFinite(afterMs) ? afterMs + 1 : Date.now() - 5 * 60_000;
  const awsCreds = await getUserCloudCredentials(session.user.email, "aws") as AwsCredentials | null;
  const client = new CloudWatchLogsClient(getAwsClientOptions(region, awsCreds ?? undefined));

  try {
    console.info(`[api/aws/logs:${requestId}] query`, {
      email: session.user.email,
      region,
      functionName,
      logGroupName,
      after,
      startTime: toIso(startTime),
      limit,
      credentialMode: awsCreds?.accessKeyId ? "stored_user_credentials" : "default_chain",
    });

    const res = await client.send(new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime: Date.now() + 5_000,
      limit,
    }));

    const events = (res.events ?? [])
      .filter((event) => typeof event.message === "string")
      .map((event) => {
        const message = event.message ?? "";
        const payload = safeJsonParse(message.trim());
        const accessLog = payload?.type === "lambda_function_url_access" ? payload : null;
        const method = typeof accessLog?.method === "string" ? accessLog.method : undefined;
        const path = typeof accessLog?.path === "string" ? accessLog.path : undefined;
        const userAgent = typeof accessLog?.userAgent === "string" ? accessLog.userAgent : undefined;
        const remoteIp = typeof accessLog?.sourceIp === "string" ? accessLog.sourceIp : "";
        const status = typeof accessLog?.status === "number" ? accessLog.status : 200;

        return {
          timestamp: toIso(event.timestamp),
          severity: "INFO",
          message,
          payload,
          httpRequest: method || path ? {
            method: method ?? "",
            url: path ?? "",
            status,
            latency: "",
            remoteIp,
            responseSize: "",
            userAgent: userAgent ?? "",
          } : undefined,
        };
      })
      .filter((entry) => {
        if (entry.payload && (entry.payload as Record<string, unknown>).type === "lambda_function_url_access") return true;
        return Boolean(entry.httpRequest);
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    console.info(`[api/aws/logs:${requestId}] entries returned`, {
      email: session.user.email,
      region,
      functionName,
      count: events.length,
      scanned: res.events?.length ?? 0,
    });

    return NextResponse.json({
      entries: events,
      count: events.length,
      logGroupName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/aws/logs:${requestId}] error`, {
      email: session.user.email,
      region,
      functionName,
      logGroupName,
      message,
    });
    return NextResponse.json({ error: message || "Failed to fetch AWS logs" }, { status: 500 });
  }
}
