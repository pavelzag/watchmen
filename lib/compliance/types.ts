export type ControlStatus = "pass" | "fail" | "warning" | "suppressed";
export type ControlImpact = "critical" | "high" | "medium" | "low";

export interface ControlResult {
  id: string;              // e.g. "CC6.1.a"
  title: string;
  description: string;
  status: ControlStatus;
  impact: ControlImpact;
  evidence: { name: string; projectId: string }[];  // failing resources
  remediationHint: string;
  justification?: string;  // set when suppressed
}

export interface ComplianceCategory {
  id: string;              // "CC6"
  name: string;
  description: string;
  controls: ControlResult[];
}

export interface ComplianceReport {
  standard: string;        // "SOC 2 Type II"
  generatedAt: string;
  totalControls: number;
  passingControls: number;
  failingControls: number;
  warningControls: number;
  suppressedControls: number;
  score: number;           // 0–100 (pass=1, suppressed=1, warning=0.5, fail=0)
  categories: ComplianceCategory[];
}
