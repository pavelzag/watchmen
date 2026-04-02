import { callAI, type AIProvider } from "@/lib/ai/client";
import { searchTfFiles, getFileContent } from "@/lib/github/client";
import type { RemediationTarget } from "@/lib/github/remediation-targets";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
export type { RemediationTarget } from "@/lib/github/remediation-targets";

export interface TfFilePatch {
  path: string;
  originalContent: string;
  fixedContent: string;
  sha: string;
  isNewFile?: boolean;
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

const STRONGLY_DEPRIORITIZED_PATH_PATTERNS = [
  /(^|\/)test(s)?\//,
  /(^|\/)fixtures?\//,
  /(^|\/)examples?\//,
  /attack-scenarios/,
  /faulty/,
  /\.terraform-originals\//,
];

const PATH_PREFERRED_BASENAMES = ["main.tf", "network.tf", "security.tf", "iam.tf", "firewall.tf"];
const MAX_RELEVANT_FILES = 4;
const MAX_FETCHED_FILES = 20;
const FETCH_BATCH_SIZE = 6;
const FETCH_CONCURRENCY = 4;
const MAX_FILES_TO_REMEDIATE = 3;
const AI_CONCURRENCY = 2;
const MAX_TARGETS_PER_FILE_PROMPT = 8;
const MIN_TARGETS_PER_FILE_PROMPT = 2;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_DESCRIPTION_LENGTH = 220;
const MAX_PROMPT_DETAILS_PER_TARGET = 4;
const MAX_MITIGATIONS_PER_TARGET = 3;

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
  if (cached && cached.expiresAt > Date.now()) return cached.paths;

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

function scoreTargetForFile(filePath: string, fileContent: string, target: RemediationTarget): number {
  const normalizedPath = filePath.toLowerCase();
  const normalizedContent = fileContent.toLowerCase();
  let score = 0;

  if (target.resourceType) {
    for (const hint of RESOURCE_PATH_HINTS[target.resourceType] ?? []) {
      if (normalizedPath.includes(hint) || normalizedContent.includes(hint)) score += 4;
    }
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

function buildPromptFromTargets(filePath: string, fileContent: string, targets: RemediationTarget[]): string {
  const targetDetails = buildTargetDetails(targets);

  return `You are a Terraform security expert. The following GCP security findings and attack paths were detected:

${targetDetails}

Fix the Terraform file below to remediate ALL of these issues. Apply the principle of least privilege.
Rules:
- Restrict open firewall rules (source_ranges containing 0.0.0.0/0 or ::/0) to internal CIDRs unless the target details indicate a narrower scope
- Remove public allUsers/allAuthenticatedUsers principals from Cloud Run, Secret Manager, and Storage IAM bindings
- For roles/editor, roles/owner, and roles/storage.admin bindings, replace broad membership with least-privilege access scoped to only the resources actually needed
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
    .filter((entry) => entry.score > 0)
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
          const data = await getFileContent(token, owner, repo, filePath);
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
- For public storage buckets, enforce public_access_prevention = "enforced" when you touch the bucket resource
- For Cloud SQL backup misconfigurations, enable backups and use a concrete start_time
- Include provider configuration only when needed by the generated resources
- Return ONLY the complete Terraform file content, no markdown fences, no explanation`;
}

async function generateNewSecurityFile(
  targets: RemediationTarget[],
  aiProvider: AIProvider,
  aiApiKey: string,
  timeoutMs: number,
  scope = "github/terraform-remediation",
  onProgress?: BuildRemediationPlanOptions["onProgress"]
): Promise<string | null> {
  try {
    const prompt = buildNewFilePrompt(targets);
    emitProgress(onProgress, {
      stage: "generate_fallback",
      message: "Generating fallback Terraform security file",
      percent: 90,
      metadata: { targetCount: targets.length },
    });
    debugLog(scope, "generateFallbackFile:start", {
      targetCount: targets.length,
      promptLength: prompt.length,
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
    return content.trim() || null;
  } catch (error) {
    debugError(scope, "generateFallbackFile failed", error, { targetCount: targets.length });
    return null;
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
  const results = await mapWithConcurrency(selected, AI_CONCURRENCY, async ({ filePath, pathScore, contentScore, finalScore, deprioritized }) => {
    const file = fileMap.get(filePath);
    if (!file) return null;

    const { content: originalContent, sha } = file;
    if (originalContent.length > 200_000) {
      debugLog(scope, "skipLargeFile", { filePath, size: originalContent.length });
      return null;
    }

    const promptSelection = selectTargetsForFilePrompt(filePath, originalContent, targets);
    const prompt = promptSelection.prompt;

    debugLog(scope, "filePromptSelected", {
      filePath,
      finalScore,
      deprioritized,
      targetCountTotal: promptSelection.targetCountTotal,
      targetCountUsed: promptSelection.targetCountUsed,
      targetIdsUsed: promptSelection.targetIdsUsed,
      promptTrimmed: promptSelection.promptTrimmed,
      promptLength: promptSelection.promptLength,
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
      }, async () =>
        Promise.race([
          callAI(aiProvider, aiApiKey, prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("AI timed out")), timeoutMs)
          ),
        ])
      );

      const trimmedFixed = fixedContent.trim();
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
        return { path: filePath, originalContent, fixedContent: trimmedFixed, sha };
      }

      debugLog(scope, "aiRemediateFile:noChange", { filePath });
      return null;
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
      });
      return null;
    }
  });

  return {
    patches: results.filter((result): result is TfFilePatch => Boolean(result)),
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
  emitProgress(options.onProgress, {
    stage: "start",
    message: "Starting remediation analysis",
    percent: 0,
    metadata: { repo: `${owner}/${repo}`, targetCount: targets.length },
  });
  debugLog(scope, "buildRemediationPlan:start", {
    repo: `${owner}/${repo}`,
    targetCount: targets.length,
    targetKinds: [...new Set(targets.map((target) => target.kind))],
  });

  const allTfPaths = await withDebugTiming(scope, "searchTfFiles", {
    repo: `${owner}/${repo}`,
  }, () => searchTfFilesCached(token, owner, repo));
  emitProgress(options.onProgress, {
    stage: "list_tf_files",
    message: `Found ${allTfPaths.length} Terraform files in the repository`,
    percent: 10,
    metadata: { totalPaths: allTfPaths.length },
  });
  const tfPaths = allTfPaths.filter(
    (path) => !path.includes(".terraform-originals/") && !path.endsWith("-faulty.tf")
  );
  debugLog(scope, "searchTfFiles:filtered", {
    totalPaths: allTfPaths.length,
    terraformPaths: tfPaths.length,
  });

  if (tfPaths.length === 0) {
      return {
        patches: [],
        failures: [],
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

  const AI_TIMEOUT_MS = 45_000;
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
    const newFileContent = await generateNewSecurityFile(targets, aiProvider, aiApiKey, AI_TIMEOUT_MS, scope, options.onProgress);
    if (!newFileContent) {
      return {
        patches: [],
        failures: [],
        summary: "No Terraform files matched the selected findings or attack paths, and AI could not generate a fallback fix file.",
      };
    }
    return {
      patches: [
        {
          path: "watchmen-security-fixes.tf",
          originalContent: "",
          fixedContent: newFileContent,
          sha: "",
          isNewFile: true,
        },
      ],
      failures: [],
      summary: "No existing Terraform files matched. Generated a new watchmen-security-fixes.tf with the requested remediations.",
    };
  }

  const { patches, failures } = await remediateExistingFiles(
    relevantFiles,
    fileMap,
    targets,
    aiProvider,
    aiApiKey,
    AI_TIMEOUT_MS,
    scope,
    options.onProgress
  );

  if (patches.length === 0) {
    const newFileContent = await generateNewSecurityFile(targets, aiProvider, aiApiKey, AI_TIMEOUT_MS, scope, options.onProgress);
    if (newFileContent) {
      return {
        patches: [
          {
            path: "watchmen-security-fixes.tf",
            originalContent: "",
            fixedContent: newFileContent,
            sha: "",
            isNewFile: true,
          },
        ],
        failures,
        summary: "Matched Terraform files did not yield direct edits. Generated a new watchmen-security-fixes.tf as a fallback remediation.",
      };
    }
  }

  const targetSummary = `${targets.length} item${targets.length === 1 ? "" : "s"}`;
  emitProgress(options.onProgress, {
    stage: "complete",
    message: `Prepared ${patches.length} patch${patches.length === 1 ? "" : "es"}`,
    percent: 100,
    metadata: { patchCount: patches.length, relevantFileCount: relevantFiles.length },
  });
  return {
    patches,
    failures,
    summary: `Found ${patches.length} file${patches.length === 1 ? "" : "s"} to update across ${relevantFiles.length} matched Terraform file${relevantFiles.length === 1 ? "" : "s"} for ${targetSummary}.${failures.length > 0 ? ` ${failures.length} file${failures.length === 1 ? "" : "s"} failed during remediation.` : ""}`,
  };
}
