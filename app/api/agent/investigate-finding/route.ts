import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rejectDemoAi } from "@/lib/ai/demo";
import { resolveAI, type AIProvider } from "@/lib/ai/client";
import { completeAgentRun, createAgentRun } from "@/lib/agent/store";
import { investigateFinding } from "@/lib/agent/investigate-finding";
import type { AgentFindingInput } from "@/lib/agent/types";

export const maxDuration = 300;

const AGENT_RESPONSE_TIMEOUT_MS = 120_000;

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Investigation timed out before Watchmen could finish the evidence report. Try again, or use Plan fix if you only need remediation guidance.")), timeoutMs);
  });
  return Promise.race([work, timeoutPromise]).finally(() => clearTimeout(timeout));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  const body = await req.json().catch(() => ({}));
  const finding = (body.finding ?? body) as AgentFindingInput;
  const prompt = typeof body.prompt === "string" ? body.prompt : finding.prompt ?? "";

  let provider: AIProvider;
  let apiKey: string;
  const browserKey = body.demoCredentials?.aiKey;
  const browserProvider = body.demoCredentials?.aiProvider as AIProvider | undefined;

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

  const run = await createAgentRun({
    userEmail: session.user.email,
    workflow: "investigate_finding",
    prompt,
    input: finding,
  });

  try {
    const result = await withTimeout(
      investigateFinding({
        runId: run.id,
        userEmail: session.user.email,
        isDemoUser: session.isDemoUser,
        input: finding,
        provider,
        apiKey,
      }),
      AGENT_RESPONSE_TIMEOUT_MS
    );
    const completed = await completeAgentRun({
      runId: run.id,
      status: "completed",
      output: result,
    });

    return NextResponse.json({
      runId: completed.id,
      status: completed.status,
      report: result.report,
      context: result.context,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to investigate finding.";
    console.error("[api/agent/investigate-finding] error:", err);
    await completeAgentRun({
      runId: run.id,
      status: "failed",
      output: {},
      error: message,
    });
    return NextResponse.json({ runId: run.id, error: message }, { status: 500 });
  }
}
