import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI, type AIProvider } from "@/lib/ai/client";
import { rejectDemoAi } from "@/lib/ai/demo";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  const body = await req.json().catch(() => ({}));

  let provider: AIProvider;
  let apiKey: string;
  const browserKey = body.demoCredentials?.aiKey;
  const browserProvider = body.demoCredentials?.aiProvider as AIProvider;

  if (browserKey && browserProvider) {
    provider = browserProvider;
    apiKey = browserKey;
  } else {
    try {
      const resolved = await resolveAI(session.user.email, session.isDemoUser);
      provider = resolved.provider;
      apiKey = resolved.key;
    } catch (err: any) {
      if (err.message === "DEMO_LIMIT_REACHED") {
        return NextResponse.json(
          { error: "Daily demo AI limit reached (20 queries). Please provide your own Gemini/Claude key in Settings to continue." },
          { status: 429 }
        );
      }
      const demoMsg = session.isDemoUser ? " (or provide your own API key in Settings)" : " in Settings";
      return NextResponse.json({ error: `No AI key configured${demoMsg}.` }, { status: 422 });
    }
  }

  const { logs, nodeLabel, nodeType, container, question } = body as {
    logs: { timestamp: string; severity: string; message: string; httpRequest?: any }[];
    nodeLabel: string;
    nodeType: string;
    container?: string;
    question?: string;
  };

  if (!logs?.length) {
    return NextResponse.json({ error: "No logs provided." }, { status: 400 });
  }

  const logLines = logs.slice(0, 100).map(e => {
    const ts = e.timestamp ? new Date(e.timestamp).toISOString() : "";
    if (e.httpRequest) {
      const h = e.httpRequest;
      return `${ts} [${h.method ?? ""}] ${h.url ?? ""} → ${h.status ?? "?"} (${h.latency ?? ""}) ip=${h.remoteIp ?? ""}`;
    }
    return `${ts} [${e.severity ?? ""}] ${e.message}`;
  }).join("\n");

  const context = container ? `${nodeType} / ${nodeLabel} / container: ${container}` : `${nodeType} / ${nodeLabel}`;

  const prompt = `You are a senior DevOps / SRE engineer analyzing Kubernetes pod logs from a GCP cluster.

**Context**: ${context}

**Log entries (most recent first)**:
\`\`\`
${logLines}
\`\`\`

${question ? `**User question**: ${question}\n\n` : ""}Analyze these logs and respond with:

### Summary
2–3 sentences describing the overall traffic pattern, error rate, and health of this service based on the logs.

### Notable Events
Bullet-point any errors, anomalies, slow requests (>500ms), unusual status codes, or repeated patterns worth investigating.

### Recommendations
Up to 3 concrete, actionable suggestions based on what you see in the logs.

Be concise and specific. Reference actual values from the logs (paths, status codes, IPs, latencies) where relevant.`;

  try {
    const analysis = await callAI(provider, apiKey, prompt);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[api/logs/analyze] error:", err);
    return NextResponse.json({ error: "Failed to analyze logs." }, { status: 500 });
  }
}
