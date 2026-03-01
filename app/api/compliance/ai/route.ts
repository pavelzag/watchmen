import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI } from "@/lib/ai/client";

interface ComplianceAiRequest {
  controlId: string;
  title: string;
  description: string;
  evidence: { name: string; projectId: string }[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ComplianceAiRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let provider: string;
  let apiKey: string;
  try {
    const resolved = await resolveAI(session.user.email);
    provider = resolved.provider;
    apiKey = resolved.key;
  } catch {
    return NextResponse.json(
      { error: "No AI key configured. Add one in Settings." },
      { status: 422 }
    );
  }

  const affectedList =
    body.evidence.length > 0
      ? body.evidence.map((e) => `- ${e.name} (project: ${e.projectId})`).join("\n")
      : "No specific resources identified (control passed or evidence not available).";

  const prompt = `You are a senior GCP security and compliance engineer specializing in SOC 2 audits. A compliance scanner flagged the following SOC 2 Type II control violation. Provide a detailed, actionable remediation guide.

**SOC 2 Control**
- Control ID: ${body.controlId}
- Title: ${body.title}
- Description: ${body.description}

**Affected Resources**
${affectedList}

Respond with exactly these four sections in markdown:

### Why This Fails SOC 2
Explain in 2–3 sentences why this specific control is required by SOC 2 Trust Service Criteria and what auditors look for.

### Step-by-Step Remediation
Provide numbered steps with concrete \`gcloud\` CLI commands or GCP Console navigation paths. Make commands copy-paste ready (use placeholder values like PROJECT_ID where appropriate).

### How to Prevent Recurrence
2–3 bullet points on org policy, IaC guardrails, or process changes that ensure ongoing compliance.

### Audit Evidence to Collect
1–2 bullet points describing the evidence artifacts (logs, screenshots, config exports) an auditor would want to see after remediation.

Keep the entire response concise and actionable. Do not include an introduction or conclusion.`;

  try {
    const recommendation = await callAI(provider as Parameters<typeof callAI>[0], apiKey, prompt);
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/compliance/ai] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
