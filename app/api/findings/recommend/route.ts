import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI, type AIProvider } from "@/lib/ai/client";
import type { SecurityFinding } from "@/lib/gcp/types";

type CloudFindingRequest = SecurityFinding & {
  cloud?: "gcp" | "aws";
  region?: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyData = await req.json().catch(() => ({}));

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

  const finding = bodyData as CloudFindingRequest;
  const cloud = finding.cloud === "aws" ? "aws" : "gcp";
  const cloudName = cloud === "aws" ? "AWS" : "GCP";
  const engineerRole = cloud === "aws" ? "senior AWS security engineer" : "senior GCP security engineer";
  const cliTool = cloud === "aws" ? "AWS CLI" : "gcloud";
  const consoleName = cloud === "aws" ? "AWS Console" : "GCP Console";
  const accountLabel = cloud === "aws" ? "Account" : "Project";
  const regionLine = finding.region ? `- Region: ${finding.region}\n` : "";

  const prompt = `You are a ${engineerRole}. A security scanner found the following issue in a ${cloudName} environment. Provide a detailed, actionable remediation guide.

**Finding**
- Title: ${finding.title}
- Severity: ${finding.severity?.toUpperCase()}
- Resource: ${finding.resourceName} (type: ${finding.resourceType})
- ${accountLabel}: ${finding.projectId}
${regionLine}- Cloud: ${cloudName}
- Description: ${finding.description}
- Initial hint: ${finding.remediationHint ?? "N/A"}

Respond with exactly these four sections in markdown:

### Why This Is a Risk
Explain the security risk in 2–4 sentences. Be specific about what an attacker could do.

### Step-by-Step Remediation
Provide numbered steps with concrete \`${cliTool}\` commands or ${consoleName} navigation paths. Make commands copy-paste ready (use placeholder values like ${cloud === "aws" ? "ACCOUNT_ID, REGION, RESOURCE_NAME" : "PROJECT_ID"} where appropriate).

### How to Prevent Recurrence
2–3 bullet points on org policy, IaC guardrails, or process changes that prevent this class of finding.

### Impact if Left Unresolved
1–2 sentences on the worst-case scenario if this finding is ignored.

Keep the entire response concise and actionable. Do not include an introduction or conclusion.`;

  try {
    const recommendation = await callAI(provider, apiKey, prompt);
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/findings/recommend] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
