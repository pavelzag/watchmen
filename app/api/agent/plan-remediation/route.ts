import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rejectDemoAi } from "@/lib/ai/demo";
import { resolveAI, type AIProvider } from "@/lib/ai/client";
import { completeAgentRun, createAgentRun } from "@/lib/agent/store";
import { planRemediation, type PlanRemediationInput } from "@/lib/agent/plan-remediation";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  const body = await req.json().catch(() => ({}));
  const input = body as PlanRemediationInput & {
    demoCredentials?: { aiKey?: string; aiProvider?: AIProvider };
  };
  const { demoCredentials: _demoCredentials, ...agentInput } = input;

  let provider: AIProvider;
  let apiKey: string;
  const browserKey = input.demoCredentials?.aiKey;
  const browserProvider = input.demoCredentials?.aiProvider;

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
    workflow: "plan_remediation",
    prompt: agentInput.objective ?? "",
    input: agentInput,
  });

  try {
    const result = await planRemediation({
      runId: run.id,
      input: agentInput,
      provider,
      apiKey,
    });
    const completed = await completeAgentRun({
      runId: run.id,
      status: "completed",
      output: result,
    });

    return NextResponse.json({
      runId: completed.id,
      status: completed.status,
      report: result.report,
      plan: result.plan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to plan remediation.";
    console.error("[api/agent/plan-remediation] error:", err);
    await completeAgentRun({
      runId: run.id,
      status: "failed",
      output: {},
      error: message,
    });
    return NextResponse.json({ runId: run.id, error: message }, { status: 500 });
  }
}
