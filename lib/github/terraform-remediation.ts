import { callAI, type AIProvider } from "@/lib/ai/client";
import { searchTfFiles, getFileContent } from "@/lib/github/client";
import {
  buildRemediationBatchSuggestions,
  type RemediationBatchSuggestion,
  type RemediationTarget,
} from "@/lib/github/remediation-targets";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
export type { RemediationTarget } from "@/lib/github/remediation-targets";

export interface TfFilePatch {
  path: string;
  originalContent: string;
  fixedContent: string;
  sha: string;
  isNewFile?: boolean;
  targetIdsCovered?: string[];
}

export type RemediationFailureReason =
  | "timeout"
  | "billing"
  | "rate_limited"
  | "provider_error"
  | "unknown";

export interface RemediationFileFailure {
  filePath: string;
  reason: RemediationFailureReason;
  message: string;
  retryable: boolean;
  targetIdsUsed: string[];
  promptLength: number;
}

export interface RemediationPlan {
  patches: TfFilePatch[];
  failures: RemediationFileFailure[];
  coveredTargetIds: string[];
  uncoveredTargets: RemediationTarget[];
  fullyAddressed: boolean;
  suggestedBatches: RemediationBatchSuggestion[];
  summary: string;
}

export interface RemediationProgressEvent {
  stage:
    | "start"
    | "list_tf_files"
    | "rank_candidates"
    | "fetch_candidates"
    | "analyze_files"
    | "build_plan"
    | "create_branch"
    | "commit_files"
    | "open_pull_request"
    | "notify"
    | "generate_fallback"
    | "complete";
  message: string;
  completed?: number;
  total?: number;
  percent?: number;
  metadata?: Record<string, unknown>;
}

interface BuildRemediationPlanOptions {
  onProgress?: (event: RemediationProgressEvent) => void;
  scope?: string;
}

function normalizeTerm(term: string): string | null {
  const normalized = term.trim().toLowerCase();
  return normalized.length >= 4 ? normalized : null;
}

const TF_PATH_CACHE_TTL_MS = 60_000;
const tfPathCache = new Map<string, { expiresAt: number; paths: string[] }>();

export function clearRemediationCaches(): void {
  tfPathCache.clear();
}

const RESOURCE_PATH_HINTS: Record<string, string[]> = {
  cloud_run: ["run", "cloudrun", "serverless"],
  cloud_sql: ["sql", "database", "db"],
  firewall_rule: ["firewall", "network", "vpc", "ingress"],
  secret: ["secret", "secrets", "kms"],
  secrets: ["secret", "secrets", "kms"],
  service_account: ["iam", "service-account", "service_account", "identity"],
  storage_bucket: ["bucket", "storage", "gcs"],
  vm: ["compute", "instance", "vm"],
};

interface ScoredPath {
  filePath: string;
  pathScore: number;
  pathBoost: number;
  pathPenalty: number;
  pathSignals: string[];
  deprioritized: boolean;
}

interface ScoredFile extends ScoredPath {
  contentScore: number;
  finalScore: number;
  matchedTargetCount: number;
}

interface SelectedTargetsForFile {
  targets: RemediationTarget[];
  prompt: string;
  promptLength: number;
  targetCountUsed: number;
  targetCountTotal: number;
  targetIdsUsed: string[];
  promptTrimmed: boolean;
}

interface RemediateExistingFilesResult {
  patches: TfFilePatch[];
  failures: RemediationFileFailure[];
}

interface GeneratedFileResult {
  content: string | null;
  targetIdsCovered: string[];
}

const STRONGLY_DEPRIORITIZED_PATH_PATTERNS = [
  /(^|\/)test(s)?\//,
  /(^|\/)fixtures?\//,
  /(^|\/)examples?\//,
  /attack-scenarios/,
  /faulty/,
  /\.terraform-originals\//,
];
const EXCLUDED_PATH_PATTERNS = [
  /(^|\/)backup(s)?\//,
  /(^|\/)archive(s)?\//,
  /(^|\/)snapshot(s)?\//,
  /(^|\/)\d{4}-\d{2}-\d{2}[-_/]/,
];

const PATH_PREFERRED_BASENAMES = ["main.tf", "network.tf", "security.tf", "iam.tf", "firewall.tf"];
const MAX_RELEVANT_FILES = 4;
const MAX_FETCHED_FILES = 20;
const FETCH_BATCH_SIZE = 6;
const FETCH_CONCURRENCY = 4;
const MAX_FILES_TO_REMEDIATE = 3;
const MAX_TARGETS_PER_FILE_PROMPT = 8;
const MIN_TARGETS_PER_FILE_PROMPT = 2;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_DESCRIPTION_LENGTH = 220;
const MAX_PROMPT_DETAILS_PER_TARGET = 4;
const MAX_MITIGATIONS_PER_TARGET = 3;
const PRIMARY_AI_TIMEOUT_MS = 30_000;
const SECONDARY_AI_TIMEOUT_MS = 18_000;
const FALLBACK_AI_TIMEOUT_MS = 10_000;
const MIN_TARGET_SCORE_FOR_FILE = 6;
const MAX_FALLBACK_TARGETS = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runner())
  );

  return results;
}

async function searchTfFilesCached(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const cacheKey = `${owner}/${repo}`;
  const cached = tfPathCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    debugLog("github/terraform-remediation", "searchTfFilesCached:hit", {
      cacheKey,
      pathCount: cached.paths.length,
      expiresInMs: cached.expiresAt - Date.now(),
    });
    return cached.paths;
  }
  if (cached) {
    debugLog("github/terraform-remediation", "searchTfFilesCached:expired", {
      cacheKey,
      pathCount: cached.paths.length,
    });
  } else {
    debugLog("github/terraform-remediation", "searchTfFilesCached:miss", { cacheKey });
  }

  const paths = await searchTfFiles(token, owner, repo);
  tfPathCache.set(cacheKey, { paths, expiresAt: Date.now() + TF_PATH_CACHE_TTL_MS });
  return paths;
}

function emitProgress(
  onProgress: BuildRemediationPlanOptions["onProgress"],
  event: RemediationProgressEvent
): void {
  onProgress?.(event);
}

function classifyAiRemediationError(error: unknown): {
  reason: RemediationFailureReason;
  message: string;
  retryable: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("timed out")) {
    return { reason: "timeout", message, retryable: true };
  }
  if (
    normalizedMessage.includes("credit balance is too low") ||
    normalizedMessage.includes("plans & billing") ||
    normalizedMessage.includes("purchase credits")
  ) {
    return { reason: "billing", message, retryable: false };
  }
  if (normalizedMessage.includes("rate limit") || normalizedMessage.includes("429")) {
    return { reason: "rate_limited", message, retryable: true };
  }
  if (
    normalizedMessage.includes("invalid_request_error") ||
    normalizedMessage.includes("api error") ||
    normalizedMessage.includes("anthropic") ||
    normalizedMessage.includes("openai")
  ) {
    return { reason: "provider_error", message, retryable: true };
  }
  return { reason: "unknown", message, retryable: true };
}

function abbreviate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(maxLength - 3, 0)).trimEnd()}...`;
}

function buildTargetDetails(targets: RemediationTarget[]): string {
  return targets
    .map((target) => {
      const header = `- ${target.title} [${target.severity}] (${target.kind.replace("_", " ")})`;
      const description = `  Description: ${abbreviate(target.description, MAX_DESCRIPTION_LENGTH)}`;
      const resourcesLabel = target.kind === "attack_path" ? "  Resources involved:" : "  Affected resources:";
      const resourceLines = target.promptDetails.length > 0
        ? target.promptDetails.slice(0, MAX_PROMPT_DETAILS_PER_TARGET).join("\n")
        : "    - No resource details supplied";
      const mitigationLines = target.mitigations.length > 0
        ? `\n  Existing hints:\n${target.mitigations.slice(0, MAX_MITIGATIONS_PER_TARGET).map((hint) => `    - ${abbreviate(hint, 140)}`).join("\n")}`
        : "";

      return `${header}\n${description}\n${resourcesLabel}\n${resourceLines}${mitigationLines}`;
    })
    .join("\n\n");
}

function getPathRelevanceScore(filePath: string, targets: RemediationTarget[]): ScoredPath {
  const normalizedPath = filePath.toLowerCase();
  let pathBoost = 0;
  let pathPenalty = 0;
  const pathSignals: string[] = [];

  for (const target of targets) {
    if (target.resourceType) {
      for (const hint of RESOURCE_PATH_HINTS[target.resourceType] ?? []) {
        if (normalizedPath.includes(hint)) {
          pathBoost += 4;
          pathSignals.push(`resource_hint:${hint}`);
        }
      }
    }

    for (const term of target.searchTerms.slice(0, 12)) {
      if (normalizedPath.includes(term)) {
        pathBoost += 6;
        pathSignals.push(`term:${term}`);
      }

      const compactTerm = term.replace(/[^a-z0-9]/g, "");
      if (compactTerm.length >= 4 && normalizedPath.replace(/[^a-z0-9]/g, "").includes(compactTerm)) {
        pathBoost += 3;
        pathSignals.push(`compact_term:${compactTerm}`);
      }
    }
  }

  if (normalizedPath.includes("terraform")) {
    pathBoost += 1;
    pathSignals.push("path:terraform");
  }
  if (normalizedPath.includes("modules/")) {
    pathBoost += 1;
    pathSignals.push("path:modules");
  }
  if (normalizedPath.startsWith("gcp/") || normalizedPath.startsWith("aws/")) {
    pathBoost += 4;
    pathSignals.push("path:cloud-root");
  }
  if (PATH_PREFERRED_BASENAMES.some((basename) => normalizedPath.endsWith(basename))) {
    pathBoost += 8;
    pathSignals.push("path:preferred-basename");
  }

  const deprioritizedReasons = STRONGLY_DEPRIORITIZED_PATH_PATTERNS.filter((pattern) => pattern.test(normalizedPath));
  if (deprioritizedReasons.length > 0) {
    pathPenalty += 120;
    pathSignals.push("path:deprioritized");
  }

  return {
    filePath,
    pathBoost,
    pathPenalty,
    pathScore: pathBoost - pathPenalty,
    pathSignals,
    deprioritized: deprioritizedReasons.length > 0,
  };
}

function isExcludedTerraformPath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function isBackupLikePath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  return /(^|\/)(backup|backups|archive|archives|snapshot|snapshots)(\/|$)/.test(normalizedPath);
}

function getCanonicalTerraformPath(filePath: string): string {
  const segments = filePath.split("/");
  if (!isBackupLikePath(filePath)) return filePath;

  const preferredRoots = new Set(["gcp", "aws", "modules"]);
  const rootIndex = segments.findIndex((segment, index) =>
    index > 0 && (preferredRoots.has(segment.toLowerCase()) || segment.endsWith(".tf"))
  );

  if (rootIndex === -1) return filePath;
  return segments.slice(rootIndex).join("/");
}

function comparePathPreference(a: string, b: string): number {
  const aBackup = isBackupLikePath(a);
  const bBackup = isBackupLikePath(b);
  if (aBackup !== bBackup) return aBackup ? 1 : -1;

  const aDepth = a.split("/").length;
  const bDepth = b.split("/").length;
  if (aDepth !== bDepth) return aDepth - bDepth;

  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function dedupeTerraformPaths(tfPaths: string[]): string[] {
  const bestByCanonical = new Map<string, string>();

  for (const filePath of tfPaths) {
    const canonicalPath = getCanonicalTerraformPath(filePath);
    const currentBest = bestByCanonical.get(canonicalPath);
    if (!currentBest || comparePathPreference(filePath, currentBest) < 0) {
      bestByCanonical.set(canonicalPath, filePath);
    }
  }

  return [...bestByCanonical.values()];
}

function getFileRelevanceScore(content: string, targets: RemediationTarget[]): { score: number; matchedTargetCount: number } {
  const normalizedContent = content.toLowerCase();
  let score = 0;
  let matchedTargetCount = 0;

  for (const target of targets) {
    const matchedTerms = new Set<string>();

    for (const projectId of target.projectIds) {
      const normalizedProjectId = normalizeTerm(projectId);
      if (normalizedProjectId && normalizedContent.includes(normalizedProjectId)) {
        matchedTerms.add(normalizedProjectId);
      }
    }

    for (const term of target.searchTerms) {
      if (normalizedContent.includes(term)) matchedTerms.add(term);
    }

    if (matchedTerms.size > 0) {
      matchedTargetCount += 1;
      score += matchedTerms.size;
      if (target.resourceName && normalizedContent.includes(target.resourceName.toLowerCase())) {
        score += 3;
      }
    }
  }

  return { score, matchedTargetCount };
}

function rankTfPaths(tfPaths: string[], targets: RemediationTarget[]): ScoredPath[] {
  return tfPaths
    .map((filePath) => getPathRelevanceScore(filePath, targets))
    .sort((a, b) => {
      if (b.pathScore !== a.pathScore) return b.pathScore - a.pathScore;
      if (a.deprioritized !== b.deprioritized) return a.deprioritized ? 1 : -1;
      return a.filePath.localeCompare(b.filePath);
    });
}

function getFinalCandidateScore(candidate: Pick<ScoredFile, "pathScore" | "contentScore" | "deprioritized">): number {
  const score = candidate.pathScore * 4 + candidate.contentScore;
  return candidate.deprioritized ? score - 150 : score;
}

function inferredTargetPathHints(target: RemediationTarget): string[] {
  const hints = new Set<string>();
  if (target.resourceType) {
    for (const hint of RESOURCE_PATH_HINTS[target.resourceType] ?? []) hints.add(hint);
  }

  for (const detail of target.promptDetails) {
    const normalizedDetail = detail.toLowerCase();
    if (normalizedDetail.includes("[iam]") || normalizedDetail.includes("service_account")) {
      hints.add("iam");
      hints.add("identity");
    }
    if (normalizedDetail.includes("[firewall_rule]") || normalizedDetail.includes("firewall")) {
      hints.add("firewall");
      hints.add("network");
      hints.add("compute");
    }
    if (normalizedDetail.includes("[vm]") || normalizedDetail.includes("[compute") || normalizedDetail.includes("instance")) {
      hints.add("compute");
      hints.add("vm");
    }
  }

  return [...hints];
}

function scoreTargetForFile(filePath: string, fileContent: string, target: RemediationTarget): number {
  const normalizedPath = filePath.toLowerCase();
  const normalizedContent = fileContent.toLowerCase();
  let score = 0;
  if (target.autoRemediable === false) return 0;
  const pathHints = inferredTargetPathHints(target);
  const hasPathHintMatch = pathHints.some((hint) => normalizedPath.includes(hint));
  const hasContentHintMatch = pathHints.some((hint) => normalizedContent.includes(hint));

  if (target.id.startsWith("secret_in_env:cloudrun:") && !normalizedPath.includes("cloud_run")) {
    return 0;
  }
  if (target.id.startsWith("sql_public_ip:") && !(normalizedPath.includes("sql") || normalizedPath.includes("database"))) {
    return 0;
  }
  if (target.id.startsWith("public_firewall:") && !(normalizedPath.includes("firewall") || normalizedPath.includes("compute") || normalizedPath.includes("network"))) {
    return 0;
  }
  if (
    (target.id.startsWith("sa_owner_editor:") || target.id.startsWith("user_owner_editor:") || target.id.startsWith("user-lateral:")) &&
    !(normalizedPath.includes("iam") || normalizedPath.includes("identity"))
  ) {
    return 0;
  }

  if (pathHints.length > 0 && !hasPathHintMatch && !hasContentHintMatch) {
    if (!target.resourceName || !normalizedPath.includes(target.resourceName.toLowerCase())) {
      return 0;
    }
  }

  for (const hint of pathHints) {
    if (normalizedPath.includes(hint)) score += 5;
    if (normalizedContent.includes(hint)) score += 3;
  }

  for (const projectId of target.projectIds) {
    const normalizedProjectId = normalizeTerm(projectId);
    if (normalizedProjectId && normalizedContent.includes(normalizedProjectId)) score += 5;
  }

  if (target.resourceName) {
    const resourceName = target.resourceName.toLowerCase();
    if (normalizedPath.includes(resourceName)) score += 8;
    if (normalizedContent.includes(resourceName)) score += 12;
  }

  for (const term of target.searchTerms.slice(0, 16)) {
    if (normalizedPath.includes(term)) score += 4;
    if (normalizedContent.includes(term)) score += 3;
  }

  return score;
}

function shouldAttemptFallbackForTargets(targets: RemediationTarget[]): boolean {
  return targets.every((target) => {
    if (target.resourceType) return true;
    const detailBlob = target.promptDetails.join(" ").toLowerCase();
    return (
      detailBlob.includes("[iam]") ||
      detailBlob.includes("[firewall_rule]") ||
      detailBlob.includes("[storage_bucket]") ||
      detailBlob.includes("[cloud_run]") ||
      detailBlob.includes("[cloud_sql]") ||
      detailBlob.includes("[vm]") ||
      detailBlob.includes("[service_account]")
    );
  });
}

function buildPromptFromTargets(filePath: string, fileContent: string, targets: RemediationTarget[]): string {
  const targetDetails = buildTargetDetails(targets);

  return `You are a Terraform security expert. The following GCP security findings and attack paths were detected:

${targetDetails}

Fix the Terraform file below to remediate ALL of these issues. Apply the principle of least privilege.
Rules:
- Restrict open firewall rules (source_ranges containing 0.0.0.0/0 or ::/0) to internal CIDRs unless the target details indicate a narrower scope
- Remove public allUsers/allAuthenticatedUsers principals from Cloud Run, Secret Manager, and Storage IAM bindings
- For roles/editor, roles/owner, and roles/storage.admin bindings, replace broad membership with least-privilege access scoped to only the resources actually needed
- If you need a service account key, use a single google_service_account_key resource. Do not create locals that store hard-coded key IDs or key ID arrays.
- Do not emit locals blocks unless they are required for the fixed Terraform file. Never invent *_key_ids locals or for_each loops over service account keys.
- For publicly exposed storage buckets, add public_access_prevention = "enforced" when the bucket resource exists in this file
- For Cloud SQL instances with disabled backups, enable backups and set a concrete start_time
- Preserve unrelated resources and arguments exactly as-is
- Return ONLY the complete fixed file content, no markdown fences, no explanation

File: ${filePath}
${fileContent}`;
}

function selectTargetsForFilePrompt(
  filePath: string,
  fileContent: string,
  targets: RemediationTarget[]
): SelectedTargetsForFile {
  const rankedTargets = targets
    .map((target) => ({
      target,
      score: scoreTargetForFile(filePath, fileContent, target),
    }))
    .filter((entry) => entry.score >= MIN_TARGET_SCORE_FOR_FILE)
    .sort((a, b) => b.score - a.score);

  const fallbackTargets = rankedTargets.length > 0
    ? rankedTargets.map((entry) => entry.target)
    : targets.slice();

  let selectedTargets = fallbackTargets.slice(0, Math.min(MAX_TARGETS_PER_FILE_PROMPT, fallbackTargets.length));
  if (selectedTargets.length === 0 && targets.length > 0) {
    selectedTargets = targets.slice(0, Math.min(MIN_TARGETS_PER_FILE_PROMPT, targets.length));
  }

  let prompt = buildPromptFromTargets(filePath, fileContent, selectedTargets);
  let promptTrimmed = false;

  while (prompt.length > MAX_PROMPT_LENGTH && selectedTargets.length > MIN_TARGETS_PER_FILE_PROMPT) {
    selectedTargets = selectedTargets.slice(0, selectedTargets.length - 1);
    prompt = buildPromptFromTargets(filePath, fileContent, selectedTargets);
    promptTrimmed = true;
  }

  if (prompt.length > MAX_PROMPT_LENGTH && fallbackTargets.length > 0) {
    selectedTargets = fallbackTargets.slice(0, 1);
    prompt = buildPromptFromTargets(filePath, fileContent, selectedTargets);
    promptTrimmed = true;
  }

  return {
    targets: selectedTargets,
    prompt,
    promptLength: prompt.length,
    targetCountUsed: selectedTargets.length,
    targetCountTotal: targets.length,
    targetIdsUsed: selectedTargets.map((target) => target.id),
    promptTrimmed,
  };
}

async function fetchRelevantFiles(
  token: string,
  owner: string,
  repo: string,
  rankedPaths: ScoredPath[],
  targets: RemediationTarget[],
  scope: string,
  onProgress?: BuildRemediationPlanOptions["onProgress"]
): Promise<{ fileMap: Map<string, { content: string; sha: string }>; relevantFiles: ScoredFile[] }> {
  const fileMap = new Map<string, { content: string; sha: string }>();
  const relevantFiles = new Map<string, ScoredFile>();
  const preferredPaths = rankedPaths.filter((path) => !path.deprioritized);
  const deprioritizedPaths = rankedPaths.filter((path) => path.deprioritized);
  const fetchPlan = [...preferredPaths, ...deprioritizedPaths].slice(0, Math.min(rankedPaths.length, MAX_FETCHED_FILES));
  debugLog(scope, "fetchRelevantFiles:start", {
    rankedCount: rankedPaths.length,
    fetchPlanCount: fetchPlan.length,
    preferredCount: preferredPaths.length,
    deprioritizedCount: deprioritizedPaths.length,
    targetCount: targets.length,
  });

  for (let start = 0; start < fetchPlan.length; start += FETCH_BATCH_SIZE) {
    const batch = fetchPlan.slice(start, Math.min(start + FETCH_BATCH_SIZE, fetchPlan.length));
    if (batch.length === 0) break;
    emitProgress(onProgress, {
      stage: "fetch_candidates",
      message: `Fetching Terraform candidate batch ${Math.floor(start / FETCH_BATCH_SIZE) + 1}`,
      completed: Math.min(start, fetchPlan.length),
      total: fetchPlan.length,
      percent: Math.round((Math.min(start, fetchPlan.length) / Math.max(fetchPlan.length, 1)) * 100),
      metadata: { batchSize: batch.length, candidatePaths: batch.map((item) => item.filePath) },
    });

    debugLog(scope, "fetchCandidateBatch:start", {
      batchStart: start,
      batchSize: batch.length,
      candidatePaths: batch.map((item) => item.filePath),
    });

    await withDebugTiming(scope, "fetchCandidateBatch", {
      batchStart: start,
      batchSize: batch.length,
    }, async () => {
      await mapWithConcurrency(batch, FETCH_CONCURRENCY, async ({ filePath, pathScore }) => {
        try {
          const data = await withDebugTiming(scope, "fetchCandidateFile", {
            filePath,
            batchStart: start,
          }, () => getFileContent(token, owner, repo, filePath));
          fileMap.set(filePath, data);

          const { score: contentScore, matchedTargetCount } = getFileRelevanceScore(data.content, targets);
          const scoredPath = batch.find((item) => item.filePath === filePath);
          const finalScore = getFinalCandidateScore({
            pathScore,
            contentScore,
            deprioritized: Boolean(scoredPath?.deprioritized),
          });
          debugLog(scope, "candidateEvaluated", {
            filePath,
            pathScore,
            contentScore,
            matchedTargetCount,
            finalScore,
            deprioritized: scoredPath?.deprioritized ?? false,
            pathSignals: scoredPath?.pathSignals ?? [],
          });

          if (contentScore > 0) {
            relevantFiles.set(filePath, {
              filePath,
              pathScore,
              contentScore,
              matchedTargetCount,
              finalScore,
              pathBoost: scoredPath?.pathBoost ?? 0,
              pathPenalty: scoredPath?.pathPenalty ?? 0,
              pathSignals: scoredPath?.pathSignals ?? [],
              deprioritized: scoredPath?.deprioritized ?? false,
            });
          }
        } catch (error) {
          debugError(scope, "candidateFetchFailed", error, { filePath });
        }
      });
    });
    debugLog(scope, "fetchCandidateBatch:complete", {
      batchStart: start,
      batchSize: batch.length,
      fetchedCount: fileMap.size,
      relevantCount: relevantFiles.size,
    });

    if (relevantFiles.size >= MAX_RELEVANT_FILES) {
      debugLog(scope, "enoughRelevantFilesFound", {
        relevantCount: relevantFiles.size,
        fetchedCount: fileMap.size,
      });
      emitProgress(onProgress, {
        stage: "fetch_candidates",
        message: `Found ${relevantFiles.size} relevant Terraform files`,
        completed: fileMap.size,
        total: fetchPlan.length,
        percent: 100,
        metadata: { relevantCount: relevantFiles.size, fetchedCount: fileMap.size },
      });
      break;
    }
  }

  return {
    fileMap,
    relevantFiles: [...relevantFiles.values()].sort((a, b) => {
      const scoreDiff = b.finalScore - a.finalScore;
      if (scoreDiff !== 0) return scoreDiff;
      if (a.deprioritized !== b.deprioritized) return a.deprioritized ? 1 : -1;
      return a.filePath.localeCompare(b.filePath);
    }),
  };
}

function buildNewFilePrompt(targets: RemediationTarget[]): string {
  const targetDetails = buildTargetDetails(targets);

  return `You are a Terraform security expert. The following GCP security findings and attack paths were detected:

${targetDetails}

Generate a new Terraform file called "watchmen-security-fixes.tf" that addresses ALL of these issues.
Rules:
- Use the exact resource names and project IDs listed above — do not invent fictional names
- Restrict open firewall rules (source_ranges 0.0.0.0/0 or ::/0) to internal CIDRs such as ["10.0.0.0/8"] unless the finding clearly demands a narrower range
- Remove public allUsers/allAuthenticatedUsers access from Cloud Run, Secret Manager, and Storage IAM bindings
- For overly broad project IAM grants (roles/owner, roles/editor, roles/storage.admin), replace them with least-privilege bindings scoped only to the required resources
- If you need a service account key, use a single google_service_account_key resource. Do not create locals that store hard-coded key IDs or key ID arrays.
- Do not emit locals blocks unless they are required for the fixed Terraform file. Never invent *_key_ids locals or for_each loops over service account keys.
- For public storage buckets, enforce public_access_prevention = "enforced" when you touch the bucket resource
- For Cloud SQL backup misconfigurations, enable backups and use a concrete start_time
- Include provider configuration only when needed by the generated resources
- Return ONLY the complete Terraform file content, no markdown fences, no explanation`;
}

function removeKeyIdLocals(content: string): string {
  return content.replace(/(^|\n)locals\s*\{([\s\S]*?)\n\}/g, (match, prefix, body) => {
    const assignmentNames = [...body.matchAll(/^\s*([A-Za-z0-9_]+)\s*=/gm)].map((entry) => entry[1]);
    if (assignmentNames.length === 0) return match;
    if (!assignmentNames.every((name) => name.endsWith("_key_ids"))) return match;
    debugLog("github/terraform-remediation", "stripKeyIdLocals", {
      assignmentNames,
    });
    return prefix.trimEnd();
  });
}

function sanitizeTerraformRemediationContent(content: string): string {
  return removeKeyIdLocals(content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function generateNewSecurityFile(
  targets: RemediationTarget[],
  aiProvider: AIProvider,
  aiApiKey: string,
  timeoutMs: number,
  scope = "github/terraform-remediation",
  onProgress?: BuildRemediationPlanOptions["onProgress"]
): Promise<GeneratedFileResult> {
  try {
    const prompt = buildNewFilePrompt(targets);
    debugLog(scope, "generateFallbackFile:prompt", {
      targetCount: targets.length,
      promptLength: prompt.length,
      timeoutMs,
      targetIds: targets.slice(0, 10).map((target) => target.id),
    });
    emitProgress(onProgress, {
      stage: "generate_fallback",
      message: "Generating fallback Terraform security file",
      percent: 90,
      metadata: { targetCount: targets.length },
    });
    const content = await withDebugTiming(scope, "generateFallbackFile", {
      targetCount: targets.length,
      promptLength: prompt.length,
    }, async () =>
      Promise.race([
        callAI(aiProvider, aiApiKey, prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI timed out")), timeoutMs)
        ),
      ])
    );
    debugLog(scope, "generateFallbackFile:result", {
      targetCount: targets.length,
      contentLength: content.length,
    });
    return {
      content: content.trim() || null,
      targetIdsCovered: targets.map((target) => target.id),
    };
  } catch (error) {
    debugError(scope, "generateFallbackFile failed", error, { targetCount: targets.length });
    return {
      content: null,
      targetIdsCovered: [],
    };
  }
}

async function remediateExistingFiles(
  fileCandidates: ScoredFile[],
  fileMap: Map<string, { content: string; sha: string }>,
  targets: RemediationTarget[],
  aiProvider: AIProvider,
  aiApiKey: string,
  timeoutMs: number,
  scope: string,
  onProgress?: BuildRemediationPlanOptions["onProgress"]
): Promise<RemediateExistingFilesResult> {
  const selected = fileCandidates.slice(0, MAX_FILES_TO_REMEDIATE);
  emitProgress(onProgress, {
    stage: "analyze_files",
    message: `Analyzing ${selected.length} Terraform file${selected.length === 1 ? "" : "s"} with AI`,
    completed: 0,
    total: selected.length,
    percent: 60,
    metadata: {
      selected: selected.map((file) => file.filePath),
    },
  });
  debugLog(scope, "remediateExistingFiles:selected", {
    selected: selected.map((file) => ({
      filePath: file.filePath,
      pathScore: file.pathScore,
      contentScore: file.contentScore,
      finalScore: file.finalScore,
      deprioritized: file.deprioritized,
      pathPenalty: file.pathPenalty,
      pathSignals: file.pathSignals,
    })),
  });

  let completed = 0;
  const failures: RemediationFileFailure[] = [];
  const results: Array<TfFilePatch | null> = [];
  for (const [index, candidate] of selected.entries()) {
    const { filePath, pathScore, contentScore, finalScore, deprioritized } = candidate;
    const file = fileMap.get(filePath);
    if (!file) {
      results.push(null);
      continue;
    }

    const { content: originalContent, sha } = file;
    if (originalContent.length > 200_000) {
      debugLog(scope, "skipLargeFile", { filePath, size: originalContent.length });
      results.push(null);
      continue;
    }

    const promptSelection = selectTargetsForFilePrompt(filePath, originalContent, targets);
    const prompt = promptSelection.prompt;
    const timeoutMsForFile = index === 0 ? timeoutMs : Math.min(timeoutMs, SECONDARY_AI_TIMEOUT_MS);

    debugLog(scope, "filePromptSelected", {
      filePath,
      finalScore,
      deprioritized,
      targetCountTotal: promptSelection.targetCountTotal,
      targetCountUsed: promptSelection.targetCountUsed,
      targetIdsUsed: promptSelection.targetIdsUsed,
      promptTrimmed: promptSelection.promptTrimmed,
      promptLength: promptSelection.promptLength,
      isBackup: isBackupLikePath(filePath),
      timeoutMs: timeoutMsForFile,
    });

    try {
      const fixedContent = await withDebugTiming(scope, "aiRemediateFile", {
        filePath,
        pathScore,
        contentScore,
        finalScore,
        deprioritized,
        fileSize: originalContent.length,
        promptLength: promptSelection.promptLength,
        targetCountTotal: promptSelection.targetCountTotal,
        targetCountUsed: promptSelection.targetCountUsed,
        targetIdsUsed: promptSelection.targetIdsUsed,
        promptTrimmed: promptSelection.promptTrimmed,
        isBackup: isBackupLikePath(filePath),
        timeoutMs: timeoutMsForFile,
      }, async () =>
        Promise.race([
          callAI(aiProvider, aiApiKey, prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("AI timed out")), timeoutMsForFile)
          ),
        ])
      );

      const trimmedFixed = sanitizeTerraformRemediationContent(fixedContent.trim());
      completed += 1;
      emitProgress(onProgress, {
        stage: "analyze_files",
        message: `Analyzed ${filePath}`,
        completed,
        total: selected.length,
        percent: 60 + Math.round((completed / Math.max(selected.length, 1)) * 25),
        metadata: {
          filePath,
          changed: trimmedFixed && trimmedFixed !== originalContent.trim(),
          targetCountUsed: promptSelection.targetCountUsed,
          promptTrimmed: promptSelection.promptTrimmed,
        },
      });
      if (trimmedFixed && trimmedFixed !== originalContent.trim()) {
        debugLog(scope, "aiRemediateFile:changed", { filePath });
        results.push({
          path: filePath,
          originalContent,
          fixedContent: trimmedFixed,
          sha,
          targetIdsCovered: promptSelection.targetIdsUsed,
        });
        continue;
      }

      debugLog(scope, "aiRemediateFile:noChange", { filePath });
      results.push(null);
    } catch (error) {
      const classifiedError = classifyAiRemediationError(error);
      failures.push({
        filePath,
        reason: classifiedError.reason,
        message: classifiedError.message,
        retryable: classifiedError.retryable,
        targetIdsUsed: promptSelection.targetIdsUsed,
        promptLength: promptSelection.promptLength,
      });
      completed += 1;
      emitProgress(onProgress, {
        stage: "analyze_files",
        message: `Analysis failed for ${filePath}`,
        completed,
        total: selected.length,
        percent: 60 + Math.round((completed / Math.max(selected.length, 1)) * 25),
        metadata: { filePath, failed: true, reason: classifiedError.reason, retryable: classifiedError.retryable },
      });
      debugError(scope, "aiRemediateFile failed", error, {
        filePath,
        reason: classifiedError.reason,
        retryable: classifiedError.retryable,
        isBackup: isBackupLikePath(filePath),
        timeoutMs: timeoutMsForFile,
      });
      results.push(null);
    }
  }

  return {
    patches: results.filter((result): result is NonNullable<typeof result> => Boolean(result)),
    failures,
  };
}

export async function buildRemediationPlan(
  token: string,
  owner: string,
  repo: string,
  targets: RemediationTarget[],
  aiProvider: AIProvider,
  aiApiKey: string,
  options: BuildRemediationPlanOptions = {}
): Promise<RemediationPlan> {
  const scope = options.scope ?? "github/terraform-remediation";
  const planStartedAt = Date.now();
  const manualReviewTargets = targets.filter((target) => target.autoRemediable === false);
  const autoTargets = targets.filter((target) => target.autoRemediable !== false);
  emitProgress(options.onProgress, {
    stage: "start",
    message: "Starting remediation analysis",
    percent: 0,
    metadata: { repo: `${owner}/${repo}`, targetCount: targets.length, autoTargetCount: autoTargets.length, manualReviewCount: manualReviewTargets.length },
  });
  debugLog(scope, "buildRemediationPlan:start", {
    repo: `${owner}/${repo}`,
    targetCount: targets.length,
    autoTargetCount: autoTargets.length,
    manualReviewCount: manualReviewTargets.length,
    targetKinds: [...new Set(targets.map((target) => target.kind))],
  });

  if (autoTargets.length === 0) {
    debugLog(scope, "buildRemediationPlan:complete", {
      durationMs: Date.now() - planStartedAt,
      patchCount: 0,
      failureCount: 0,
      uncoveredCount: targets.length,
      reason: "manual_review_only",
    });
    return {
      patches: [],
      failures: [],
      coveredTargetIds: [],
      uncoveredTargets: targets,
      fullyAddressed: false,
      suggestedBatches: buildRemediationBatchSuggestions(targets),
      summary: `Selected items require manual review and are not eligible for Terraform auto-remediation.${manualReviewTargets.length > 0 ? ` ${manualReviewTargets.length} item${manualReviewTargets.length === 1 ? "" : "s"} were classified as review-only.` : ""}`,
    };
  }

  const allTfPaths = await withDebugTiming(scope, "searchTfFiles", {
    repo: `${owner}/${repo}`,
  }, () => searchTfFilesCached(token, owner, repo));
  emitProgress(options.onProgress, {
    stage: "list_tf_files",
    message: `Found ${allTfPaths.length} Terraform files in the repository`,
    percent: 10,
    metadata: { totalPaths: allTfPaths.length },
  });
  const nonGeneratedPaths = allTfPaths.filter(
    (path) => !path.includes(".terraform-originals/") && !path.endsWith("-faulty.tf")
  );
  const excludedPaths = nonGeneratedPaths.filter((path) => isExcludedTerraformPath(path));
  const tfPaths = dedupeTerraformPaths(
    nonGeneratedPaths.filter((path) => !isExcludedTerraformPath(path))
  );
  debugLog(scope, "searchTfFiles:filtered", {
    totalPaths: allTfPaths.length,
    excludedPaths: excludedPaths.length,
    dedupedAwayPaths: nonGeneratedPaths.length - excludedPaths.length - tfPaths.length,
    terraformPaths: tfPaths.length,
  });

  if (tfPaths.length === 0) {
    debugLog(scope, "buildRemediationPlan:complete", {
      durationMs: Date.now() - planStartedAt,
      patchCount: 0,
      failureCount: 0,
      uncoveredCount: targets.length,
      reason: "no_terraform_files",
    });
    return {
      patches: [],
      failures: [],
      coveredTargetIds: [],
      uncoveredTargets: targets,
      fullyAddressed: false,
      suggestedBatches: buildRemediationBatchSuggestions(targets),
      summary: "No Terraform files found in this repository.",
    };
  }

  const rankedPaths = rankTfPaths(tfPaths, targets);
  emitProgress(options.onProgress, {
    stage: "rank_candidates",
    message: `Ranked ${rankedPaths.length} Terraform files by likely relevance`,
    percent: 25,
    metadata: { topCandidates: rankedPaths.slice(0, 5).map((item) => item.filePath) },
  });
  debugLog(scope, "rankTfPaths:topCandidates", {
    topCandidates: rankedPaths.slice(0, 10).map((candidate) => ({
      filePath: candidate.filePath,
      pathScore: candidate.pathScore,
      pathBoost: candidate.pathBoost,
      pathPenalty: candidate.pathPenalty,
      deprioritized: candidate.deprioritized,
      pathSignals: candidate.pathSignals,
    })),
  });

  const AI_TIMEOUT_MS = PRIMARY_AI_TIMEOUT_MS;
  const { fileMap, relevantFiles } = await fetchRelevantFiles(
    token,
    owner,
    repo,
    rankedPaths,
    targets,
    scope,
    options.onProgress
  );
  debugLog(scope, "fetchRelevantFiles:done", {
    fetchedFiles: fileMap.size,
    relevantFiles: relevantFiles.map((file) => ({
      filePath: file.filePath,
      pathScore: file.pathScore,
      contentScore: file.contentScore,
    })),
  });

  if (relevantFiles.length === 0) {
    const fallback = await generateNewSecurityFile(autoTargets, aiProvider, aiApiKey, AI_TIMEOUT_MS, scope, options.onProgress);
    if (!fallback.content) {
      debugLog(scope, "buildRemediationPlan:complete", {
        durationMs: Date.now() - planStartedAt,
        patchCount: 0,
        failureCount: 0,
        uncoveredCount: targets.length,
        reason: "no_fallback_generated",
      });
      return {
        patches: [],
        failures: [],
        coveredTargetIds: [],
        uncoveredTargets: [...autoTargets, ...manualReviewTargets],
        fullyAddressed: false,
        suggestedBatches: buildRemediationBatchSuggestions([...autoTargets, ...manualReviewTargets]),
        summary: `No Terraform files matched the selected findings or attack paths, and AI could not generate a fallback fix file.${manualReviewTargets.length > 0 ? ` ${manualReviewTargets.length} item${manualReviewTargets.length === 1 ? "" : "s"} also require manual review.` : ""}`,
      };
    }
    debugLog(scope, "buildRemediationPlan:complete", {
      durationMs: Date.now() - planStartedAt,
      patchCount: 1,
      failureCount: 0,
      uncoveredCount: manualReviewTargets.length,
      reason: "generated_fallback_file",
    });
    return {
      patches: [
        {
          path: "watchmen-security-fixes.tf",
          originalContent: "",
          fixedContent: sanitizeTerraformRemediationContent(fallback.content),
          sha: "",
          isNewFile: true,
          targetIdsCovered: fallback.targetIdsCovered,
        },
      ],
      failures: [],
      coveredTargetIds: fallback.targetIdsCovered,
      uncoveredTargets: manualReviewTargets,
      fullyAddressed: manualReviewTargets.length === 0,
      suggestedBatches: [],
      summary: `No existing Terraform files matched. Generated a new watchmen-security-fixes.tf with the requested remediations.${manualReviewTargets.length > 0 ? ` ${manualReviewTargets.length} item${manualReviewTargets.length === 1 ? "" : "s"} still require manual review.` : ""}`,
    };
  }

  const { patches, failures } = await remediateExistingFiles(
    relevantFiles,
    fileMap,
    autoTargets,
    aiProvider,
    aiApiKey,
    AI_TIMEOUT_MS,
    scope,
    options.onProgress
  );

  const coveredTargetIds = new Set<string>(
    patches.flatMap((patch) => patch.targetIdsCovered ?? [])
  );
  let uncoveredTargets = autoTargets.filter((target) => !coveredTargetIds.has(target.id));

  if (uncoveredTargets.length > 0) {
    debugLog(scope, "uncoveredTargets:detected", {
      uncoveredCount: uncoveredTargets.length,
      uncoveredTargetIds: uncoveredTargets.map((target) => target.id),
    });
    emitProgress(options.onProgress, {
      stage: "generate_fallback",
      message: `Generating fallback remediation for ${uncoveredTargets.length} uncovered item${uncoveredTargets.length === 1 ? "" : "s"}`,
      percent: 88,
      metadata: { uncoveredTargetIds: uncoveredTargets.map((target) => target.id) },
    });

    if (uncoveredTargets.length > MAX_FALLBACK_TARGETS) {
      debugLog(scope, "uncoveredTargets:fallbackSkippedTooLarge", {
        uncoveredCountRemaining: uncoveredTargets.length,
        maxFallbackTargets: MAX_FALLBACK_TARGETS,
      });
    } else if (shouldAttemptFallbackForTargets(uncoveredTargets)) {
      const fallback = await generateNewSecurityFile(
        uncoveredTargets,
        aiProvider,
        aiApiKey,
        FALLBACK_AI_TIMEOUT_MS,
        scope,
        options.onProgress
      );

      if (fallback.content) {
        patches.push({
          path: "watchmen-security-fixes.tf",
          originalContent: "",
          fixedContent: sanitizeTerraformRemediationContent(fallback.content),
          sha: "",
          isNewFile: true,
          targetIdsCovered: fallback.targetIdsCovered,
        });
        for (const targetId of fallback.targetIdsCovered) coveredTargetIds.add(targetId);
      uncoveredTargets = autoTargets.filter((target) => !coveredTargetIds.has(target.id));
        debugLog(scope, "uncoveredTargets:fallbackGenerated", {
          uncoveredCountRemaining: uncoveredTargets.length,
          generatedPath: "watchmen-security-fixes.tf",
        });
      } else {
        debugLog(scope, "uncoveredTargets:fallbackFailed", {
          uncoveredCountRemaining: uncoveredTargets.length,
        });
      }
    } else {
      debugLog(scope, "uncoveredTargets:fallbackSkipped", {
        uncoveredCountRemaining: uncoveredTargets.length,
        uncoveredTargetIds: uncoveredTargets.map((target) => target.id),
      });
    }
  }

  if (patches.length === 0) {
    if (shouldAttemptFallbackForTargets(autoTargets)) {
      const fallback = await generateNewSecurityFile(autoTargets, aiProvider, aiApiKey, FALLBACK_AI_TIMEOUT_MS, scope, options.onProgress);
      if (fallback.content) {
        debugLog(scope, "buildRemediationPlan:complete", {
          durationMs: Date.now() - planStartedAt,
          patchCount: 1,
          failureCount: 0,
          uncoveredCount: manualReviewTargets.length,
          reason: "generated_fallback_file",
        });
        return {
          patches: [
            {
              path: "watchmen-security-fixes.tf",
              originalContent: "",
              fixedContent: fallback.content,
              sha: "",
              isNewFile: true,
              targetIdsCovered: fallback.targetIdsCovered,
            },
          ],
          failures,
          coveredTargetIds: fallback.targetIdsCovered,
          uncoveredTargets: manualReviewTargets,
          fullyAddressed: manualReviewTargets.length === 0,
          suggestedBatches: [],
          summary: `Matched Terraform files did not yield direct edits. Generated a new watchmen-security-fixes.tf as a fallback remediation.${manualReviewTargets.length > 0 ? ` ${manualReviewTargets.length} item${manualReviewTargets.length === 1 ? "" : "s"} still require manual review.` : ""}`,
        };
      }
    }
  }

  uncoveredTargets = [...uncoveredTargets, ...manualReviewTargets];
  const targetSummary = `${targets.length} item${targets.length === 1 ? "" : "s"}`;
  emitProgress(options.onProgress, {
    stage: "complete",
    message: `Prepared ${patches.length} patch${patches.length === 1 ? "" : "es"}`,
    percent: 100,
    metadata: { patchCount: patches.length, relevantFileCount: relevantFiles.length },
  });
  debugLog(scope, "buildRemediationPlan:complete", {
    durationMs: Date.now() - planStartedAt,
    patchCount: patches.length,
    failureCount: failures.length,
    relevantFileCount: relevantFiles.length,
    coveredTargetCount: coveredTargetIds.size,
    uncoveredCount: uncoveredTargets.length,
    fullyAddressed: uncoveredTargets.length === 0,
  });
  return {
    patches,
    failures,
    coveredTargetIds: [...coveredTargetIds],
    uncoveredTargets,
    fullyAddressed: uncoveredTargets.length === 0,
    suggestedBatches: uncoveredTargets.length > 0 ? buildRemediationBatchSuggestions(uncoveredTargets) : [],
    summary: uncoveredTargets.length === 0
      ? `Found ${patches.length} file${patches.length === 1 ? "" : "s"} to update across ${relevantFiles.length} matched Terraform file${relevantFiles.length === 1 ? "" : "s"} for ${targetSummary}.${failures.length > 0 ? ` ${failures.length} file${failures.length === 1 ? "" : "s"} failed during remediation.` : ""}`
      : `Prepared ${patches.length} patch${patches.length === 1 ? "" : "es"}, but ${uncoveredTargets.length} of ${targets.length} selected item${targets.length === 1 ? "" : "s"} remain uncovered.${failures.length > 0 ? ` ${failures.length} file${failures.length === 1 ? "" : "s"} failed during remediation.` : ""}`,
  };
}
