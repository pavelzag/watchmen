import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI, type AIProvider } from "@/lib/ai/client";

type RequestPath = {
  id?: string;
  cloud?: "gcp" | "aws";
  severity?: "critical" | "high";
  title?: string;
  description?: string;
  region?: string;
  nodes?: {
    kind?: string;
    resourceType?: string;
    label?: string;
    detail?: string;
    projectId?: string;
    risk?: string;
  }[];
  mitigations?: string[];
};

type RequestBody = {
  paths?: RequestPath[];
  scope?: string;
  demoCredentials?: { aiKey?: string; aiProvider?: AIProvider };
};

function compactPath(path: RequestPath, index: number): string {
  const nodes = (path.nodes ?? [])
    .slice(0, 6)
    .map((node) =>
      `${node.kind ?? "node"}:${node.resourceType ?? "resource"}:${node.label ?? "unknown"}${node.risk ? ` (${node.risk})` : ""}`
    )
    .join(" -> ");
  const mitigations = (path.mitigations ?? []).slice(0, 3).map((item) => `  - ${item}`).join("\n");

  return `Path ${index + 1}
- Cloud: ${(path.cloud ?? "unknown").toUpperCase()}
- Severity: ${(path.severity ?? "unknown").toUpperCase()}
- Title: ${path.title ?? "Untitled"}
- Region: ${path.region ?? "n/a"}
- Description: ${path.description ?? "n/a"}
- Chain: ${nodes || "n/a"}
- Current mitigations:
${mitigations || "  - n/a"}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: RequestBody = await req.json().catch(() => ({}));
  const paths = Array.isArray(body.paths) ? body.paths.slice(0, 20) : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "No attack paths provided." }, { status: 400 });
  }

  let provider: AIProvider;
  let apiKey: string;
  const browserKey = body.demoCredentials?.aiKey;
  const browserProvider = body.demoCredentials?.aiProvider;

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
      const demoMsg = session.isDemoUser
        ? " (or provide your own API key in Settings)"
        : " in Settings";
      return NextResponse.json(
        { error: `No AI key configured${demoMsg}.` },
        { status: 422 }
      );
    }
  }

  const criticalCount = paths.filter((path) => path.severity === "critical").length;
  const highCount = paths.filter((path) => path.severity === "high").length;
  const cloudCounts = paths.reduce<Record<string, number>>((acc, path) => {
    const cloud = path.cloud ?? "unknown";
    acc[cloud] = (acc[cloud] ?? 0) + 1;
    return acc;
  }, {});

  const prompt = `You are a senior cloud security architect reviewing attack paths across AWS and GCP.

Analyze the currently visible attack paths and produce a prioritized response for an engineer.

Scope: ${body.scope ?? "visible attack paths"}
Path count: ${paths.length}
Critical: ${criticalCount}
High: ${highCount}
Cloud counts: ${Object.entries(cloudCounts).map(([cloud, count]) => `${cloud}=${count}`).join(", ")}

Attack paths:
${paths.map(compactPath).join("\n\n")}

Respond with exactly these sections in markdown:

### Executive Summary
Summarize the highest-risk exposure in 3-5 sentences.

### Priority Order
List the top paths to fix first. Explain why each one is prioritized.

### Remediation Plan
Provide concrete AWS CLI, gcloud, console, or Terraform-oriented remediation steps. Separate AWS and GCP steps when both clouds are present.

### Validation Steps
Explain how to verify each remediation worked using Watchmen and cloud-native checks.

### Prevention
Give 3-5 guardrails to prevent these attack paths from recurring.

Keep the answer concise, actionable, and specific to the supplied paths.`;

  try {
    const recommendation = await callAI(provider, apiKey, prompt);
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/attack-paths/recommend] error:", err);
    return NextResponse.json({ error: "Failed to generate attack path recommendation." }, { status: 500 });
  }
}
