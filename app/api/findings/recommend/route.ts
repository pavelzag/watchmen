import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SecurityFinding } from "@/lib/gcp/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let finding: SecurityFinding;
  try {
    finding = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are a senior GCP security engineer. A security scanner found the following issue in a GCP environment. Provide a detailed, actionable remediation guide.

**Finding**
- Title: ${finding.title}
- Severity: ${finding.severity.toUpperCase()}
- Resource: ${finding.resourceName} (type: ${finding.resourceType})
- Project: ${finding.projectId}
- Description: ${finding.description}
- Initial hint: ${finding.remediationHint ?? "N/A"}

Respond with exactly these four sections in markdown:

### Why This Is a Risk
Explain the security risk in 2–4 sentences. Be specific about what an attacker could do.

### Step-by-Step Remediation
Provide numbered steps with concrete \`gcloud\` CLI commands or GCP Console navigation paths. Make commands copy-paste ready (use placeholder values like PROJECT_ID where appropriate).

### How to Prevent Recurrence
2–3 bullet points on org policy, IaC guardrails, or process changes that prevent this class of finding.

### Impact if Left Unresolved
1–2 sentences on the worst-case scenario if this finding is ignored.

Keep the entire response concise and actionable. Do not include an introduction or conclusion.`;

    const result = await model.generateContent(prompt);
    const recommendation = result.response.text();

    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/findings/recommend] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
