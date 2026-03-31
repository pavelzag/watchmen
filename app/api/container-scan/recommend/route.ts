import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI, callAI, type AIProvider } from "@/lib/ai/client";
import type { ContainerVulnerability } from "@/lib/container-scanning";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyData = await req.json().catch(() => ({}));

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

  const finding: ContainerVulnerability & { imageRef?: string; cloud?: string } = bodyData;

  const prompt = `You are a senior DevSecOps engineer. A security scanner found the following vulnerability inside a container image. Provide a detailed, actionable remediation guide.

**Finding Context**
- Image Ref: ${finding.imageRef ?? "Unknown"}
- Cloud Environment: ${finding.cloud?.toUpperCase() ?? "Unknown"}

**Vulnerability Info**
- CVE ID: ${finding.cveId}
- Severity: ${finding.severity.toUpperCase()}
- Affected Package: ${finding.packageName}
- Installed Version: ${finding.installedVersion}
- Fixed Version: ${finding.fixedVersion ?? "No fix available yet"}
- Description: ${finding.description}

Respond with exactly these sections in markdown:

### Vulnerability Context
Explain the CVE concisely (1-2 sentences). What is the theoretical impact?

### Step-by-Step Remediation
Provide concrete steps to resolve this. If upgrading a base image is required, show a hypothetical Dockerfile change. If it's a package manager issue (npm/pip/apt), provide exact commands to force the fix.

### Risk if Unresolved
1–2 sentences outlining the worst-case scenario.

Keep the entire response concise and actionable. Do not include an introduction or conclusion.`;

  try {
    const recommendation = await callAI(provider, apiKey, prompt);
    return NextResponse.json({ recommendation });
  } catch (err) {
    console.error("[api/container-scan/recommend] error:", err);
    return NextResponse.json({ error: "Failed to generate recommendation." }, { status: 500 });
  }
}
