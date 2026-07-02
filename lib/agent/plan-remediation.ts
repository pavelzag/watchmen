import { callAI, type AIProvider } from "@/lib/ai/client";
import { recordAgentStep } from "@/lib/agent/store";
import type { AgentCloudFinding } from "@/lib/agent/types";
import { remediationTargetFromFinding, type RemediationTarget } from "@/lib/github/remediation-targets";
import type { SecurityFinding } from "@/lib/gcp/types";

export interface PlanRemediationInput {
  objective?: string;
  findings?: AgentCloudFinding[];
  finding?: AgentCloudFinding;
}

export interface RemediationPlanResult {
  report: string;
  plan: {
    objective: string;
    selectedTargets: RemediationTarget[];
    excludedFindings: Array<AgentCloudFinding & { reason: string }>;
    approvalRequired: true;
    previewEligible: boolean;
    previewBlockedReason?: string;
    nextAction: "terraform_preview" | "manual_review";
  };
}

function compactFinding(finding: AgentCloudFinding) {
  return {
    id: finding.id,
    cloud: finding.cloud,
    severity: finding.severity,
    title: finding.title,
    resourceName: finding.resourceName,
    projectId: finding.projectId,
    resourceType: finding.resourceType,
    region: finding.region,
    description: finding.description,
    remediationHint: finding.remediationHint,
  };
}

function toGcpSecurityFinding(finding: AgentCloudFinding): SecurityFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    resourceName: finding.resourceName,
    projectId: finding.projectId,
    resourceType: finding.resourceType,
    remediationHint: finding.remediationHint,
  };
}

function buildPrompt(params: {
  objective: string;
  selectedTargets: RemediationTarget[];
  excludedFindings: Array<AgentCloudFinding & { reason: string }>;
}) {
  return `You are a cloud security remediation planner for Watchmen. Use only the provided JSON.

Return concise markdown with exactly these sections:

### Remediation Goal
Summarize the goal and expected risk reduction.

### Target Resources
List the resources that should be changed and why.

### Excluded Resources
List excluded resources and why. If none, say "None."

### Proposed Fix
Describe the safest Terraform or manual remediation approach. Do not claim that a PR was created.

### Review Checklist
List concrete checks a reviewer should perform before approving a Terraform preview or PR.

Rules:
- This is a plan only. No cloud changes have been made.
- Require explicit user approval before Terraform preview or PR creation.
- If a resource is not eligible for automated Terraform remediation, say so.
- Do not invent owners, repos, files, or commands not present in the input.
- For expired service account key findings, do not invent key IDs, service account emails, or Terraform resource blocks. If the input does not provide a specific key ID, recommend manual verification/deletion instead of Terraform.
- If the input only says a service account has expired keys, treat that as evidence of a stale snapshot unless the JSON explicitly includes the key metadata.

Input:
${JSON.stringify(params, null, 2)}`;
}

export async function planRemediation(params: {
  runId: string;
  input: PlanRemediationInput;
  provider: AIProvider;
  apiKey: string;
}): Promise<RemediationPlanResult> {
  const findings = [
    ...(params.input.finding ? [params.input.finding] : []),
    ...(Array.isArray(params.input.findings) ? params.input.findings : []),
  ].filter((finding): finding is AgentCloudFinding => Boolean(finding?.id && finding?.resourceName));

  if (findings.length === 0) {
    throw new Error("At least one finding is required to plan remediation.");
  }

  const objective = params.input.objective?.trim() || `Plan remediation for ${findings.length} finding${findings.length === 1 ? "" : "s"}.`;
  const selectedTargets = findings
    .filter((finding) => finding.cloud === "gcp")
    .map((finding) => remediationTargetFromFinding(toGcpSecurityFinding(finding)));
  const excludedFindings = findings
    .filter((finding) => finding.cloud !== "gcp")
    .map((finding) => ({
      ...finding,
      reason: "Automated Terraform remediation is currently enabled only for GCP findings. Use this plan for manual AWS review until AWS remediation targets are validated.",
    }));

  await recordAgentStep({
    runId: params.runId,
    stepIndex: 1,
    toolName: "select_remediation_targets",
    status: "completed",
    input: {
      objective,
      findings: findings.map(compactFinding),
    },
    output: {
      selectedTargets,
      excludedFindings,
      previewEligible: selectedTargets.length > 0,
    },
  });

  const previewEligible = selectedTargets.length > 0;
  const plan = {
    objective,
    selectedTargets,
    excludedFindings,
    approvalRequired: true as const,
    previewEligible,
    previewBlockedReason: previewEligible
      ? undefined
      : "No selected findings are currently eligible for automated Terraform preview.",
    nextAction: previewEligible ? "terraform_preview" as const : "manual_review" as const,
  };

  await recordAgentStep({
    runId: params.runId,
    stepIndex: 2,
    toolName: "assemble_remediation_plan",
    status: "completed",
    input: { selectedTargetIds: selectedTargets.map((target) => target.id) },
    output: plan,
    requiresApproval: true,
  });

  const report = await callAI(params.provider, params.apiKey, buildPrompt({
    objective,
    selectedTargets,
    excludedFindings,
  }));

  await recordAgentStep({
    runId: params.runId,
    stepIndex: 3,
    toolName: "generate_remediation_plan_report",
    status: "completed",
    input: { provider: params.provider },
    output: { report },
  });

  return { report, plan };
}
