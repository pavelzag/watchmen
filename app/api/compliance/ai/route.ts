import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { resolveAI, callAI } from "@/lib/ai/client";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const DEMO_AI_CAP = Number(process.env.DEMO_AI_CAP ?? "10");

interface ComplianceAiRequest {
  controlId: string;
  title: string;
  description: string;
  evidence: { name: string; projectId: string }[];
  standard?: string; // "SOC 2 Type II" | "ISO 27001:2022"
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

  // Demo mode: enforce per-session query cap via HttpOnly cookie (shared with /api/query)
  let demoCookieCount = 0;
  if (DEMO_MODE) {
    const cookieStore = await cookies();
    demoCookieCount = parseInt(cookieStore.get("demo-ai-count")?.value ?? "0", 10);
    if (demoCookieCount >= DEMO_AI_CAP) {
      return NextResponse.json(
        { error: `Demo AI limit reached (${DEMO_AI_CAP} queries per session).` },
        { status: 429 }
      );
    }
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

  const standard = body.standard ?? "SOC 2 Type II";
  const affectedList =
    body.evidence.length > 0
      ? body.evidence.map((e) => `- ${e.name} (project: ${e.projectId})`).join("\n")
      : "No specific resources identified (control passed or evidence not available).";

  const prompt = `You are a senior GCP security and compliance engineer specializing in ${standard} audits. A compliance scanner flagged the following control violation. Provide a detailed, actionable remediation guide.

**${standard} Control**
- Control ID: ${body.controlId}
- Title: ${body.title}
- Description: ${body.description}

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
    const recommendation = await callAI(provider as Parameters<typeof callAI>[0], apiKey, prompt);
    const response = NextResponse.json({ recommendation });

    // Increment demo cap cookie after a successful call
    if (DEMO_MODE) {
      response.cookies.set("demo-ai-count", String(demoCookieCount + 1), {
        httpOnly: true,
        maxAge: 60 * 60 * 24,
        sameSite: "lax",
        path: "/",
      });
    }

    return response;
  } catch (err) {
    console.error("[api/compliance/ai] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
