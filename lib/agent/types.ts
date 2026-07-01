export type AgentWorkflow = "investigate_finding" | "plan_remediation" | "verify_fix";
export type AgentRunStatus = "running" | "completed" | "failed";
export type AgentStepStatus = "completed" | "failed";

export interface AgentRunRecord {
  id: string;
  workflow: AgentWorkflow;
  status: AgentRunStatus;
  prompt: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface AgentStepRecord {
  runId: string;
  stepIndex: number;
  toolName: string;
  status: AgentStepStatus;
  input: unknown;
  output: unknown;
  error?: string | null;
  requiresApproval?: boolean;
}

export interface AgentEvidenceItem {
  name: string;
  value: unknown;
  href?: string;
}

export interface AgentFindingInput {
  id?: string;
  cloud?: "gcp" | "aws";
  resourceName?: string;
  resourceType?: string;
  projectId?: string;
  accountId?: string;
  title?: string;
  prompt?: string;
}

export interface AgentCloudFinding {
  id: string;
  cloud: "gcp" | "aws";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  resourceName: string;
  projectId: string;
  resourceType: string;
  remediationHint?: string;
  region?: string;
}
