"use client";

import { useEffect, useState } from "react";
import { X, ChevronRight, Loader2, ExternalLink, AlertTriangle, Check } from "lucide-react";
import { type RemediationTarget } from "@/lib/github/remediation-targets";
import type { RemediationProgressEvent, TfFilePatch } from "@/lib/github/terraform-remediation";
import CopyTextButton from "@/components/CopyTextButton";
import { useTaskCenter } from "@/components/TaskCenterProvider";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GhRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
}

type Step =
  | "select-paths"
  | "select-repo"
  | "analyzing"
  | "preview"
  | "creating"
  | "done"
  | "error";

interface Props {
  targets: RemediationTarget[];
  onClose: () => void;
}

// ─── Diff view (before/after) ─────────────────────────────────────────────────

function DiffView({ original, fixed }: { original: string; fixed: string }) {
  const origLines = original.split("\n");
  const fixedLines = fixed.split("\n");

  // Simple line-by-line comparison — highlight changed lines
  const maxLen = Math.max(origLines.length, fixedLines.length);

  const rows: Array<{ kind: "same" | "removed" | "added"; text: string }> = [];

  let i = 0;
  let j = 0;
  while (i < origLines.length || j < fixedLines.length) {
    const origLine = origLines[i];
    const fixedLine = fixedLines[j];

    if (i >= origLines.length) {
      rows.push({ kind: "added", text: fixedLine });
      j++;
    } else if (j >= fixedLines.length) {
      rows.push({ kind: "removed", text: origLine });
      i++;
    } else if (origLine === fixedLine) {
      rows.push({ kind: "same", text: origLine });
      i++;
      j++;
    } else {
      rows.push({ kind: "removed", text: origLine });
      rows.push({ kind: "added", text: fixedLine });
      i++;
      j++;
    }
  }

  void maxLen; // suppress unused warning

  const visibleRows = rows.filter((r) => r.kind !== "same").length > 0 ? rows : rows;

  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: 11,
        overflowX: "auto",
        background: "#0a0a0b",
        border: "1px solid var(--border-dim)",
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {visibleRows.map((row, idx) => (
        <div
          key={idx}
          style={{
            padding: "1px 12px",
            whiteSpace: "pre",
            background:
              row.kind === "removed"
                ? "rgba(239,68,68,0.12)"
                : row.kind === "added"
                  ? "rgba(16,185,129,0.10)"
                  : "transparent",
            color:
              row.kind === "removed"
                ? "#f87171"
                : row.kind === "added"
                  ? "#6ee7b7"
                  : "#4b5563",
          }}
        >
          {row.kind === "removed" ? "- " : row.kind === "added" ? "+ " : "  "}
          {row.text}
        </div>
      ))}
    </div>
  );
}

// ─── Severity badge ────────────────────────────────────────────────────────────

function SevBadge({ severity }: { severity: RemediationTarget["severity"] }) {
  const styles = severity === "critical"
    ? { border: "#ef444455", color: "#ef4444", background: "#1a0606" }
    : severity === "high"
      ? { border: "#f59e0b55", color: "#f59e0b", background: "#1a1206" }
      : severity === "medium"
        ? { border: "#eab30855", color: "#eab308", background: "#171306" }
        : { border: "#64748b55", color: "#94a3b8", background: "#0f172a" };

  return (
    <span
      style={{
        fontSize: 8,
        letterSpacing: 2,
        fontFamily: "monospace",
        padding: "2px 6px",
        border: `1px solid ${styles.border}`,
        color: styles.color,
        background: styles.background,
      }}
    >
      {severity.toUpperCase()}
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function RemediateModal({ targets, onClose }: Props) {
  const [step, setStep] = useState<Step>("select-paths");
  const [selectedPathIds, setSelectedPathIds] = useState<Set<string>>(
    new Set(targets.map((target) => target.id))
  );
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [tokenRequired, setTokenRequired] = useState(false);
  const [patches, setPatches] = useState<TfFilePatch[]>([]);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prNumber, setPrNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noChanges, setNoChanges] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<RemediationProgressEvent[]>([]);
  const [analysisPercent, setAnalysisPercent] = useState(0);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [analysisFullyAddressed, setAnalysisFullyAddressed] = useState(true);
  const [analysisUncoveredTargets, setAnalysisUncoveredTargets] = useState<RemediationTarget[]>([]);
  const [creationProgress, setCreationProgress] = useState<RemediationProgressEvent[]>([]);
  const [creationPercent, setCreationPercent] = useState(0);
  const [creationSummary, setCreationSummary] = useState<string | null>(null);
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null);
  const [creationTaskId, setCreationTaskId] = useState<string | null>(null);
  const { tasks, startTerraformPreview, startTerraformPr } = useTaskCenter();

  const selectedTargets = targets.filter((target) => selectedPathIds.has(target.id));

  // ── Step 1 helpers ────────────────────────────────────────────────────────

  function togglePath(id: string) {
    setSelectedPathIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Step 2: fetch repos ───────────────────────────────────────────────────

  async function loadRepos() {
    setStep("select-repo");
    setRepoError(null);
    setTokenRequired(false);
    try {
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      if (res.status === 422 && data.tokenRequired) {
        setTokenRequired(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to load repos");
      setRepos(data.repos ?? []);
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : "Network error");
    }
  }

  // ── Step 3: analyze ───────────────────────────────────────────────────────

  async function analyze() {
    if (!selectedRepo) return;
    setStep("analyzing");
    setNoChanges(false);
    setPatches([]);
    setAnalysisProgress([]);
    setAnalysisPercent(0);
    setAnalysisSummary(null);
    setAnalysisFullyAddressed(true);
    setAnalysisUncoveredTargets([]);
    const taskId = startTerraformPreview({
      repoFullName: selectedRepo.full_name,
      defaultBranch: selectedRepo.default_branch,
      targets: selectedTargets,
    });
    setAnalysisTaskId(taskId);
  }

  // ── Step 5: create PR ─────────────────────────────────────────────────────

  async function createPr() {
    if (!selectedRepo) return;
    setStep("creating");
    setCreationProgress([]);
    setCreationPercent(0);
    setCreationSummary(null);
    const taskId = startTerraformPr({
      repoFullName: selectedRepo.full_name,
      defaultBranch: selectedRepo.default_branch,
      targets: selectedTargets,
    });
    setCreationTaskId(taskId);
  }

  // ── Filter repos by search ─────────────────────────────────────────────────

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  // ── Close on Escape ────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!analysisTaskId) return;
    const task = tasks.find((item) => item.id === analysisTaskId);
    if (!task) return;

    setAnalysisProgress(task.progress as RemediationProgressEvent[]);
    setAnalysisPercent(task.percent);

    if (task.status === "completed" && task.kind === "terraform_preview" && task.result) {
      setNoChanges(!task.result.patches || task.result.patches.length === 0);
      setPatches(task.result.patches ?? []);
      setAnalysisSummary(task.result.summary ?? null);
      setAnalysisFullyAddressed(task.result.fullyAddressed ?? true);
      setAnalysisUncoveredTargets(task.result.uncoveredTargets ?? []);
      setStep("preview");
    } else if (task.status === "failed") {
      setErrorMsg(task.error ?? "Unknown error during analysis");
      setStep("error");
    }
  }, [analysisTaskId, tasks]);

  useEffect(() => {
    if (!creationTaskId) return;
    const task = tasks.find((item) => item.id === creationTaskId);
    if (!task) return;

    setCreationProgress(task.progress as RemediationProgressEvent[]);
    setCreationPercent(task.percent);

    if (task.status === "completed" && task.kind === "terraform_pr" && task.result) {
      if (task.result.patchCount === 0) {
        setNoChanges(true);
        setCreationSummary(task.result.message ?? "No changes were needed.");
      } else {
        setPrUrl(task.result.prUrl ?? null);
        setPrNumber(task.result.prNumber ?? null);
        setCreationSummary(task.result.prNumber ? `Pull request #${task.result.prNumber} created` : null);
      }
      setStep("done");
    } else if (task.status === "failed") {
      setErrorMsg(task.error ?? "Unknown error creating PR");
      setStep("error");
    }
  }, [creationTaskId, tasks]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(2px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl flex flex-col"
        style={{
          background: "#09090b",
          border: "1px solid var(--border-dim)",
          maxHeight: "90vh",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--border-dim)" }}
        >
          <div>
            <p
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--green)",
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              // Fix with GitHub PR
            </p>
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--border-dim)", marginTop: 2 }}>
              {step === "select-paths" && "Select findings or attack paths to remediate"}
              {step === "select-repo" && "Choose a repository with Terraform files"}
              {step === "analyzing" && "Scanning Terraform files…"}
              {step === "preview" && analysisSummary && analysisSummary}
              {step === "preview" && !analysisSummary && patches.length > 0 && (
                patches.every(p => p.isNewFile)
                  ? "New security file will be created"
                  : patches.some(p => p.isNewFile)
                    ? `${patches.filter(p => !p.isNewFile).length} file(s) changed, 1 new file created`
                    : `${patches.length} file${patches.length === 1 ? "" : "s"} will be changed`
              )}
              {step === "preview" && !analysisSummary && patches.length === 0 && "No changes needed"}
              {step === "creating" && (creationSummary ?? "Opening pull request…")}
              {step === "done" && "Pull request created"}
              {step === "error" && "Something went wrong"}
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Step 1: select paths ─────────────────────────────────── */}
          {step === "select-paths" && (
            <>
              <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                Choose which security items Watchmen should attempt to fix:
              </p>
              <div className="space-y-2">
                {targets.map((target) => (
                  <label
                    key={target.id}
                    className="flex items-center gap-3 cursor-pointer group"
                    style={{ padding: "8px 12px", border: "1px solid var(--border-dim)", background: selectedPathIds.has(target.id) ? "rgba(0,170,43,0.05)" : "transparent" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPathIds.has(target.id)}
                      onChange={() => togglePath(target.id)}
                      className="accent-green-500"
                    />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <SevBadge severity={target.severity} />
                      <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--border-dim)", textTransform: "uppercase", letterSpacing: 1 }}>
                        {target.kind === "attack_path" ? "Path" : "Finding"}
                      </span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {target.title}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2: select repo ──────────────────────────────────── */}
          {step === "select-repo" && (
            <>
              {tokenRequired ? (
                <div
                  className="flex items-start gap-3 p-4"
                  style={{ border: "1px solid #f59e0b44", background: "#1a1206" }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                  <div>
                    <p style={{ fontFamily: "monospace", fontSize: 11, color: "#fbbf24", fontWeight: 700, marginBottom: 4 }}>
                      GitHub token not configured
                    </p>
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: "#6b7280", lineHeight: 1.6 }}>
                      Go to{" "}
                      <a href="/dashboard/settings?tab=integrations" target="_blank" style={{ color: "var(--green)", textDecoration: "underline" }}>
                        Settings → Integrations
                      </a>{" "}
                      to add your GitHub Personal Access Token, then come back.
                    </p>
                  </div>
                </div>
              ) : repoError ? (
                <div className="p-4" style={{ border: "1px solid #ef444444", background: "#1a0606" }}>
                  <div className="flex items-start justify-between gap-3">
                    <p style={{ fontFamily: "monospace", fontSize: 11, color: "#f87171" }}>!! {repoError}</p>
                    <CopyTextButton
                      text={repoError}
                      label="Copy"
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "#f87171" }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search repositories…"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent text-xs font-mono outline-none"
                    style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    autoFocus
                  />
                  <div
                    className="space-y-1"
                    style={{ maxHeight: 300, overflowY: "auto" }}
                  >
                    {filteredRepos.length === 0 && (
                      <p style={{ fontFamily: "monospace", fontSize: 11, color: "var(--border-dim)", padding: "12px 0" }}>
                        No repositories found.
                      </p>
                    )}
                    {filteredRepos.map((repo) => (
                      <button
                        key={repo.full_name}
                        onClick={() => setSelectedRepo(repo)}
                        className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 transition-colors"
                        style={{
                          border: "1px solid",
                          borderColor: selectedRepo?.full_name === repo.full_name ? "var(--green)" : "var(--border-dim)",
                          background: selectedRepo?.full_name === repo.full_name ? "rgba(0,170,43,0.07)" : "transparent",
                        }}
                      >
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e5e7eb" }}>
                          {repo.full_name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {repo.private && (
                            <span style={{ fontSize: 9, letterSpacing: 1, fontFamily: "monospace", color: "var(--border-dim)", border: "1px solid var(--border-dim)", padding: "1px 5px" }}>
                              PRIVATE
                            </span>
                          )}
                          <span style={{ fontSize: 9, color: "var(--border-dim)", fontFamily: "monospace" }}>
                            {repo.default_branch}
                          </span>
                          {selectedRepo?.full_name === repo.full_name && (
                            <Check className="w-3 h-3" style={{ color: "var(--green)" }} />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Step 3: analyzing ────────────────────────────────────── */}
          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--green)" }} />
              <p style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>
                Scanning Terraform files…
              </p>
              <div className="w-full max-w-md" style={{ border: "1px solid var(--border-dim)", background: "#050505", height: 10 }}>
                <div
                  style={{
                    width: `${analysisPercent}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, rgba(0,170,43,0.5), rgba(34,197,94,0.95))",
                    transition: "width 180ms ease",
                  }}
                />
              </div>
              <div className="w-full max-w-md space-y-2">
                {analysisProgress.length === 0 && (
                  <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--border-dim)" }}>
                    Initializing remediation analysis…
                  </p>
                )}
                {analysisProgress.map((progress, index) => (
                  <div
                    key={`${progress.stage}-${index}-${progress.message}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: index === analysisProgress.length - 1 ? "#e5e7eb" : "#6b7280", lineHeight: 1.5 }}>
                      {progress.message}
                    </p>
                    {(typeof progress.completed === "number" && typeof progress.total === "number") && (
                      <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--border-dim)", whiteSpace: "nowrap" }}>
                        {progress.completed}/{progress.total}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--border-dim)" }}>
                This may take a moment while AI analyzes your infrastructure code.
              </p>
              <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--green)" }}>
                You can close this modal and continue from{" "}
                <Link href="/dashboard/tasks" style={{ textDecoration: "underline", color: "var(--green)" }}>
                  Task Center
                </Link>
                .
              </p>
            </div>
          )}

          {/* ── Step 4: preview ──────────────────────────────────────── */}
          {step === "preview" && (
            <>
              {noChanges || patches.length === 0 ? (
                <div className="flex items-start gap-3 p-4" style={{ border: "1px solid var(--border-dim)", background: "rgba(0,170,43,0.04)" }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
                  <div className="flex-1 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af", lineHeight: 1.6 }}>
                        No Terraform files matched the selected resources, or no changes were needed.
                      </p>
                      {!analysisFullyAddressed && analysisUncoveredTargets.length > 0 && (
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: "#fbbf24", lineHeight: 1.6 }}>
                          {analysisUncoveredTargets.length} selected item{analysisUncoveredTargets.length === 1 ? "" : "s"} were not fully covered and will remain for manual review.
                        </p>
                      )}
                    </div>
                    <CopyTextButton
                      text={analysisSummary ?? "No Terraform files matched the selected resources, or no changes were needed."}
                      label="Copy"
                      className="text-[10px] font-mono"
                      style={{ color: "var(--green)" }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {!analysisFullyAddressed && analysisUncoveredTargets.length > 0 && (
                    <div className="flex items-start gap-3 p-4" style={{ border: "1px solid #f59e0b44", background: "#1a1206" }}>
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                      <div className="space-y-2">
                        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>
                          Some selected issues were not fully covered
                        </p>
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af", lineHeight: 1.6 }}>
                          Watchmen found patches for part of the request, but {analysisUncoveredTargets.length} selected item{analysisUncoveredTargets.length === 1 ? "" : "s"} remain uncovered. The PR will include the fixes that were generated.
                        </p>
                        <div className="space-y-1">
                          {analysisUncoveredTargets.slice(0, 8).map((target) => (
                            <p key={target.id} style={{ fontFamily: "monospace", fontSize: 10, color: "#d1d5db" }}>
                              - {target.title}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {patches.map((patch) => (
                    <div key={patch.path}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--green)" }}>
                          // {patch.path}
                        </p>
                        {patch.isNewFile && (
                          <span style={{ fontSize: 8, letterSpacing: 2, fontFamily: "monospace", padding: "2px 6px", border: "1px solid rgba(0,170,43,0.5)", color: "var(--green)", background: "rgba(0,170,43,0.08)" }}>
                            NEW FILE
                          </span>
                        )}
                      </div>
                      <DiffView original={patch.originalContent} fixed={patch.fixedContent} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Step 5: creating ─────────────────────────────────────── */}
          {step === "creating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--green)" }} />
              <p style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>
                Creating branch, committing fixes, and opening PR…
              </p>
              <div className="w-full max-w-md" style={{ border: "1px solid var(--border-dim)", background: "#050505", height: 10 }}>
                <div
                  style={{
                    width: `${creationPercent}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, rgba(0,170,43,0.5), rgba(34,197,94,0.95))",
                    transition: "width 180ms ease",
                  }}
                />
              </div>
              <div className="w-full max-w-md space-y-2">
                {creationProgress.length === 0 && (
                  <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--border-dim)" }}>
                    Initializing PR creation…
                  </p>
                )}
                {creationProgress.map((progress, index) => (
                  <div
                    key={`${progress.stage}-${index}-${progress.message}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: index === creationProgress.length - 1 ? "#e5e7eb" : "#6b7280", lineHeight: 1.5 }}>
                      {progress.message}
                    </p>
                    {(typeof progress.completed === "number" && typeof progress.total === "number") && (
                      <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--border-dim)", whiteSpace: "nowrap" }}>
                        {progress.completed}/{progress.total}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--green)" }}>
                You can close this modal and continue from{" "}
                <Link href="/dashboard/tasks" style={{ textDecoration: "underline", color: "var(--green)" }}>
                  Task Center
                </Link>
                .
              </p>
            </div>
          )}

          {/* ── Step 6: done ─────────────────────────────────────────── */}
          {step === "done" && (
            <div className="space-y-4">
              {noChanges || !prUrl ? (
                <div className="flex items-start gap-3 p-4" style={{ border: "1px solid var(--border-dim)", background: "rgba(0,170,43,0.04)" }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
                  <div className="flex-1 flex items-start justify-between gap-3">
                    <p style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af", lineHeight: 1.6 }}>
                      No changes were needed — your Terraform files already address these findings or attack paths, or no matching resources were found.
                    </p>
                    <CopyTextButton
                      text={creationSummary ?? "No changes were needed — your Terraform files already address these findings or attack paths, or no matching resources were found."}
                      label="Copy"
                      className="text-[10px] font-mono"
                      style={{ color: "var(--green)" }}
                    />
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3" style={{ border: "1px solid rgba(0,170,43,0.4)", background: "rgba(0,170,43,0.05)" }}>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
                    <p style={{ fontFamily: "monospace", fontSize: 12, color: "var(--green)", fontWeight: 700 }}>
                      Pull Request #{prNumber} created
                    </p>
                  </div>
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs font-mono transition-opacity hover:opacity-80"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    {prUrl}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* ── Step 7: error ────────────────────────────────────────── */}
          {step === "error" && (
            <div className="flex items-start gap-3 p-4" style={{ border: "1px solid #ef444444", background: "#1a0606" }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p style={{ fontFamily: "monospace", fontSize: 11, color: "#f87171", fontWeight: 700 }}>
                    Error
                  </p>
                  {errorMsg && (
                    <CopyTextButton
                      text={errorMsg}
                      label="Copy error"
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "#f87171" }}
                    />
                  )}
                </div>
                <p style={{ fontFamily: "monospace", fontSize: 10, color: "#6b7280", lineHeight: 1.6 }}>
                  {errorMsg}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderTop: "1px solid var(--border-dim)" }}
        >
          {/* Back / Cancel */}
          {(step === "select-paths" || step === "error") && (
            <button
              onClick={onClose}
              className="text-xs font-mono px-4 py-2 transition-colors"
              style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
          )}
          {step === "select-repo" && (
            <button
              onClick={() => setStep("select-paths")}
              className="text-xs font-mono px-4 py-2 transition-colors"
              style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
            >
              ← Back
            </button>
          )}
          {step === "preview" && (
            <button
              onClick={() => setStep("select-repo")}
              className="text-xs font-mono px-4 py-2 transition-colors"
              style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
            >
              ← Back
            </button>
          )}
          {step === "done" && (
            <button
              onClick={onClose}
              className="text-xs font-mono px-4 py-2 transition-colors"
              style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
            >
              Close
            </button>
          )}
          {step === "error" && (
            <button
              onClick={() => {
                setErrorMsg(null);
                setStep("select-repo");
              }}
              className="text-xs font-mono px-4 py-2 transition-colors"
              style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
            >
              ← Back
            </button>
          )}

          {/* Primary action */}
          <div className="ml-auto">
            {step === "select-paths" && (
              <button
                onClick={loadRepos}
                disabled={selectedPathIds.size === 0}
                className="flex items-center gap-2 text-xs font-mono font-bold px-5 py-2 transition-all"
                style={
                  selectedPathIds.size > 0
                    ? { background: "var(--green)", color: "var(--bg)" }
                    : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                }
              >
                Next <ChevronRight className="w-3 h-3" />
              </button>
            )}
            {step === "select-repo" && !tokenRequired && (
              <button
                onClick={analyze}
                disabled={!selectedRepo}
                className="flex items-center gap-2 text-xs font-mono font-bold px-5 py-2 transition-all"
                style={
                  selectedRepo
                    ? { background: "var(--green)", color: "var(--bg)" }
                    : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                }
              >
                Analyze <ChevronRight className="w-3 h-3" />
              </button>
            )}
            {step === "preview" && patches.length > 0 && (
              <button
                onClick={createPr}
                className="flex items-center gap-2 text-xs font-mono font-bold px-5 py-2 transition-all"
                style={{ background: "var(--green)", color: "var(--bg)" }}
              >
                Create PR <ChevronRight className="w-3 h-3" />
              </button>
            )}
            {step === "preview" && patches.length === 0 && (
              <button
                onClick={onClose}
                className="text-xs font-mono px-4 py-2"
                style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
