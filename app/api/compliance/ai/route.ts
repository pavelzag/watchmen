import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI, type AIProvider } from "@/lib/ai/client";
import { rejectDemoAi } from "@/lib/ai/demo";

interface ComplianceAiRequest {
  controlId: string;
  title: string;
  description: string;
  evidence: { name: string; projectId: string }[];
  standard?: string; // "SOC 2 Type II" | "ISO 27001:2022"
  demoCredentials?: { aiKey?: string; aiProvider?: string };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  const bodyData: ComplianceAiRequest = await req.json().catch(() => ({}));

  // Resolve the user's AI key: check body first (browser-only), then fallback to DB
  let provider: AIProvider;
  let apiKey: string;
  const browserKey = bodyData.demoCredentials?.aiKey;
  const browserProvider = bodyData.demoCredentials?.aiProvider as AIProvider;

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

  const standard = bodyData.standard ?? "SOC 2 Type II";
  const affectedList =
    bodyData.evidence?.length > 0
      ? bodyData.evidence.map((e) => `- ${e.name} (project: ${e.projectId})`).join("\n")
      : "No specific resources identified (control passed or evidence not available).";

  const prompt = `You are a senior GCP security and compliance engineer specializing in ${standard} audits. A compliance scanner flagged the following control violation. Provide a detailed, actionable remediation guide.

**${standard} Control**
- Control ID: ${bodyData.controlId}
- Title: ${bodyData.title}
- Description: ${bodyData.description}

**Affected Resources**
${affectedList}

Respond with exactly these four sections in markdown:

### Why This Fails ${standard}
Explain in 2–3 sentences why this specific control is required by ${standard} and what auditors look for.

### Step-by-Step Remediation
Provide numbered steps with concrete \`gcloud\` CLI commands or GCP Console navigation paths. Make commands copy-paste ready (use placeholder values like PROJECT_ID where appropriate).

### How to Prevent Recurrence
2–3 bullet points on org policy, IaC guardrails, or process changes that ensure ongoing compliance.

### Audit Evidence to Collect
1–2 bullet points describing the evidence artifacts (logs, screenshots, config exports) an auditor would want to see after remediation.

Keep the entire response concise and actionable. Do not include an introduction or conclusion.`;

  try {
    const recommendation = await callAI(provider, apiKey, prompt);
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/compliance/ai] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
