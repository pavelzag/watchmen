import type { RemediationTarget } from "@/lib/github/remediation-targets";
import type { RemediationFileFailure, TfFilePatch } from "@/lib/github/terraform-remediation";

export interface TaskProgressEvent {
  stage: string;
  message: string;
  completed?: number;
  total?: number;
  percent?: number;
  metadata?: Record<string, unknown>;
}

export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";

export type BackgroundTaskKind =
  | "gcp_scan"
  | "aws_scan"
  | "attack_paths"
  | "terraform_preview"
  | "terraform_pr";

export interface TaskResultMap {
  gcp_scan: {
    ok: boolean;
    fetchedAt?: string;
    snapshot?: object;
    credentialsRequired?: boolean;
    error?: string;
  };
  aws_scan: {
    ok: boolean;
    fetchedAt?: string;
    snapshot?: object;
    credentialsRequired?: boolean;
    error?: string;
  };
  attack_paths: {
    ok: boolean;
    fetchedAt?: string;
    paths?: object[];
    error?: string;
  };
  terraform_preview: {
    ok: boolean;
    repoFullName: string;
    defaultBranch: string;
    patches: TfFilePatch[];
    failures: RemediationFileFailure[];
    summary: string;
    targets: RemediationTarget[];
  };
  terraform_pr: {
    ok: boolean;
    repoFullName: string;
    defaultBranch: string;
    prUrl?: string;
    prNumber?: number;
    patchCount: number;
    message?: string;
    failures: RemediationFileFailure[];
    targets: RemediationTarget[];
  };
}

export interface TaskParamsMap {
  gcp_scan: {
    demoCredentials?: { gcp?: { serviceAccountKey?: string } };
  };
  aws_scan: {
    demoCredentials?: { aws?: { accessKeyId?: string; secretAccessKey?: string; region?: string } };
  };
  attack_paths: Record<string, never>;
  terraform_preview: {
    repoFullName: string;
    defaultBranch: string;
    targets: RemediationTarget[];
  };
  terraform_pr: {
    repoFullName: string;
    defaultBranch: string;
    targets: RemediationTarget[];
  };
}

export interface BackgroundTask<K extends BackgroundTaskKind = BackgroundTaskKind> {
  id: string;
  kind: K;
  title: string;
  status: BackgroundTaskStatus;
  createdAt: string;
  updatedAt: string;
  progress: TaskProgressEvent[];
  percent: number;
  error?: string | null;
  result?: TaskResultMap[K];
  params: TaskParamsMap[K];
}

export type AnyBackgroundTask = {
  [K in BackgroundTaskKind]: BackgroundTask<K>;
}[BackgroundTaskKind];

export interface StreamProgressEnvelope {
  type: "progress";
  progress: TaskProgressEvent;
}

export interface StreamErrorEnvelope {
  type: "error";
  error: string;
}
