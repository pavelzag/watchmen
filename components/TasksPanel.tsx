"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import CopyTextButton from "@/components/CopyTextButton";
import { useTaskCenter } from "@/components/TaskCenterProvider";
import type { RemediationFileFailure, TfFilePatch } from "@/lib/github/terraform-remediation";
import type { RemediationTarget } from "@/lib/github/remediation-targets";

function statusColor(status: string): string {
  if (status === "completed") return "#22c55e";
  if (status === "failed") return "#ef4444";
  return "#f59e0b";
}

export default function TasksPanel() {
  const { tasks, clearFinishedTasks, clearAllTasks, dismissTask, retryTask, startTerraformPreviewBatch, startTerraformPr, startVerifyFix } = useTaskCenter();
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  function toggleExpanded(taskId: string) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function renderTargetDetails(targets: RemediationTarget[], uncoveredTargetIds: Set<string> = new Set()) {
    return (
      <div className="space-y-3">
        {targets.map((target) => (
          <div
            key={target.id}
            className="space-y-2 p-3"
            style={{
              border: uncoveredTargetIds.has(target.id) ? "1px solid #f59e0b44" : "1px solid var(--border-dim)",
              background: uncoveredTargetIds.has(target.id) ? "#1a1206" : "#050505",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: 2, color: "var(--green)" }}>
                {target.severity.toUpperCase()}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--text-muted)" }}>
                [{target.kind === "attack_path" ? "PATH" : "FINDING"}]
              </span>
              {uncoveredTargetIds.has(target.id) && (
                <span style={{ fontFamily: "monospace", fontSize: 9, color: "#fbbf24" }}>
                  [UNCOVERED]
                </span>
              )}
            </div>
            <p style={{ fontFamily: "monospace", fontSize: 11, color: "#e5e7eb" }}>{target.title}</p>
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {target.description}
            </p>
            <div className="space-y-1">
              <p style={{ fontFamily: "monospace", fontSize: 9, color: "#6b7280", letterSpacing: 2 }}>
                // SUGGESTED MITIGATIONS
              </p>
              {target.mitigations.length > 0 ? (
                target.mitigations.map((mitigation, index) => (
                  <p key={`${target.id}-${index}`} style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>
                    - {mitigation}
                  </p>
                ))
              ) : (
                <p style={{ fontFamily: "monospace", fontSize: 10, color: "#6b7280" }}>
                  - AI-generated least-privilege remediation
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderFailures(failures: RemediationFileFailure[]) {
    if (failures.length === 0) return null;
    return (
      <div className="space-y-2">
        <p style={{ fontFamily: "monospace", fontSize: 9, color: "#6b7280", letterSpacing: 2 }}>
          // FILES THAT FAILED
        </p>
        {failures.map((failure, index) => (
          <div
            key={`${failure.filePath}-${index}`}
            className="space-y-1 p-3"
            style={{ border: "1px solid #ef444444", background: "#1a0606" }}
          >
            <div className="flex items-center justify-between gap-3">
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#f87171" }}>
                {failure.filePath}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 9, color: failure.retryable ? "#fbbf24" : "#f87171" }}>
                {failure.reason.toUpperCase()}
              </span>
            </div>
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af", lineHeight: 1.5 }}>
              {failure.message}
            </p>
          </div>
        ))}
      </div>
    );
  }

  function renderVerificationTargets(label: string, targets: RemediationTarget[]) {
    if (targets.length === 0) return null;
    return (
      <div className="space-y-1">
        <p style={{ fontFamily: "monospace", fontSize: 9, color: "#6b7280", letterSpacing: 2 }}>
          // {label.toUpperCase()}
        </p>
        {targets.map((target) => (
          <p key={target.id} style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>
            - {target.title}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase" style={{ color: "var(--green)" }}>
            // Task Center
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
            Long-running scans, analysis, and remediation tasks continue here while you navigate elsewhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearFinishedTasks}
            className="px-3 py-1.5 text-xs uppercase tracking-widest"
            style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
          >
            Clear Finished
          </button>
          <button
            onClick={clearAllTasks}
            className="px-3 py-1.5 text-xs uppercase tracking-widest"
            style={{ border: "1px solid #5c1600", color: "#f87171" }}
          >
            Clear All
          </button>
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="px-4 py-4 text-sm font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>
          // No background tasks yet
        </div>
      )}

      <div className="space-y-4">
        {tasks.map((task) => (
          <div key={task.id} className="p-4 space-y-4" style={{ border: "1px solid var(--border-dim)", background: "#09090b" }}>
            {(() => {
              const showMoreInfo =
                task.status === "completed" &&
                ((task.kind === "terraform_preview" && (task.result?.targets?.length ?? 0) > 0) ||
                  (task.kind === "terraform_pr" && (task.result?.targets?.length ?? 0) > 0) ||
                  (task.kind === "verify_fix" && ((task.result?.resolvedTargets?.length ?? 0) > 0 || (task.result?.remainingTargets?.length ?? 0) > 0)));
              const isExpanded = expandedTaskIds.has(task.id);

              return (
                <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span style={{ color: statusColor(task.status), fontFamily: "monospace", fontSize: 10, letterSpacing: 2 }}>
                    {task.status.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e5e7eb" }}>{task.title}</span>
                </div>
                <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                  Started {new Date(task.createdAt).toLocaleTimeString()} · updated {new Date(task.updatedAt).toLocaleTimeString()}
                  {task.lastProgressAt ? ` · last progress ${new Date(task.lastProgressAt).toLocaleTimeString()}` : ""}
                </p>
              </div>
              <button
                onClick={() => dismissTask(task.id)}
                className="flex items-center gap-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            </div>

            <div className="space-y-2">
              <div style={{ border: "1px solid var(--border-dim)", background: "#050505", height: 10 }}>
                <div
                  style={{
                    width: `${task.percent}%`,
                    height: "100%",
                    background: task.status === "failed"
                      ? "linear-gradient(90deg, rgba(239,68,68,0.5), rgba(239,68,68,0.95))"
                      : "linear-gradient(90deg, rgba(0,170,43,0.5), rgba(34,197,94,0.95))",
                    transition: "width 180ms ease",
                  }}
                />
              </div>
              <div className="space-y-1">
                {task.progress.length === 0 && task.status !== "failed" && (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span style={{ fontFamily: "monospace", fontSize: 10 }}>Queued…</span>
                  </div>
                )}
                {task.progress.map((progress, index) => (
                  <div key={`${task.id}-${progress.stage}-${index}`} className="flex items-start justify-between gap-3">
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: index === task.progress.length - 1 ? "#e5e7eb" : "#6b7280" }}>
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
            </div>

            {task.status === "failed" && (
              <div className="flex items-start justify-between gap-3 p-3" style={{ border: "1px solid #ef444444", background: "#1a0606" }}>
                <div className="flex items-start gap-2">
                  <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
                  <p style={{ fontFamily: "monospace", fontSize: 10, color: "#f87171" }}>
                    {task.error ?? "Task failed before returning an error message."}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => retryTask(task.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-widest"
                    style={{ border: "1px solid #f59e0b44", color: "#fbbf24", background: "#1a1206" }}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                  <CopyTextButton text={task.error ?? "Task failed before returning an error message."} label="Copy" className="text-[10px] font-mono" style={{ color: "#f87171" }} />
                </div>
              </div>
            )}

            {task.status === "completed" && task.kind === "terraform_preview" && task.result && (() => {
              const result = task.result;
              const failures = result.failures ?? [];
              return (
              <div className="space-y-3">
                <div className="flex items-center gap-2" style={{ color: "#22c55e" }}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {result.summary}
                  </span>
                </div>
                <CopyTextButton
                  text={result.summary}
                  label="Copy summary"
                  className="text-[10px] font-mono"
                  style={{ color: "var(--green)" }}
                />
                {!result.fullyAddressed && (result.uncoveredTargets?.length ?? 0) > 0 && (
                  <p style={{ fontFamily: "monospace", fontSize: 10, color: "#fbbf24" }}>
                    {result.uncoveredTargets.length} selected item{result.uncoveredTargets.length === 1 ? "" : "s"} remain uncovered. PR creation is disabled for this preview.
                  </p>
                )}
                {failures.length > 0 && (
                  <p style={{ fontFamily: "monospace", fontSize: 10, color: "#fbbf24" }}>
                    {failures.length} candidate file{failures.length === 1 ? "" : "s"} failed during remediation.
                  </p>
                )}
                <div className="space-y-1">
                  {result.patches.slice(0, 5).map((patch: TfFilePatch) => (
                    <p key={patch.path} style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                      // {patch.path}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (result.fullyAddressed) {
                      startTerraformPr({
                        repoFullName: result.repoFullName,
                        defaultBranch: result.defaultBranch,
                        targets: result.targets,
                      });
                      return;
                    }

                    startTerraformPreviewBatch(
                      (result.suggestedBatches ?? []).map((batch) => ({
                        repoFullName: result.repoFullName,
                        defaultBranch: result.defaultBranch,
                        targets: batch.targets,
                      }))
                    );
                  }}
                  className="px-3 py-1.5 text-xs uppercase tracking-widest"
                  style={
                    result.fullyAddressed
                      ? { border: "1px solid var(--green)", color: "var(--green)", background: "rgba(0,170,43,0.06)" }
                      : { border: "1px solid #f59e0b44", color: "#fbbf24", background: "#1a1206" }
                  }
                >
                  {result.fullyAddressed ? "Create PR" : "Create Batch Tasks"}
                </button>
                {!result.fullyAddressed && (result.suggestedBatches?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    {result.suggestedBatches.map((batch) => (
                      <p key={batch.id} style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>
                        - {batch.title} ({batch.targets.length})
                      </p>
                    ))}
                  </div>
                )}
              </div>
              );
            })()}

            {task.status === "completed" && task.kind === "terraform_pr" && task.result && (
              <div className="space-y-2">
                {(() => {
                  const failures = task.result.failures ?? [];
                  return (
                    <>
                <div className="flex items-center gap-2" style={{ color: "#22c55e" }}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {task.result.patchCount === 0
                      ? (task.result.message ?? "No changes were needed.")
                      : failures.length > 0
                        ? `Pull request #${task.result.prNumber} created with ${task.result.patchCount} successful fix${task.result.patchCount === 1 ? "" : "es"} and ${failures.length} failed file${failures.length === 1 ? "" : "s"}`
                        : `Pull request #${task.result.prNumber} created`}
                  </span>
                </div>
                {task.result.message && (
                  <div className="flex items-start justify-between gap-3">
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                      {task.result.message}
                    </p>
                    <CopyTextButton
                      text={task.result.message}
                      label="Copy message"
                      className="text-[10px] font-mono"
                      style={{ color: "var(--green)" }}
                    />
                  </div>
                )}
                {task.result.prUrl && (
                  <Link
                    href={task.result.prUrl}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open Pull Request
                  </Link>
                )}
                    </>
                  );
                })()}
              </div>
            )}

            {task.status === "completed" && task.kind === "verify_fix" && task.result && (
              <div className="space-y-2">
                {(() => {
                  const resolved = task.result.resolvedTargets ?? [];
                  const remaining = task.result.remainingTargets ?? [];
                  return (
                    <>
                      <div className="flex items-center gap-2" style={{ color: remaining.length === 0 ? "#22c55e" : "#fbbf24" }}>
                        <CheckCircle2 className="w-4 h-4" />
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {task.result.summary}
                        </span>
                      </div>
                      {task.result.report && (
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
                          {task.result.report}
                        </p>
                      )}
                      <CopyTextButton
                        text={task.result.summary}
                        label="Copy summary"
                        className="text-[10px] font-mono"
                        style={{ color: "var(--green)" }}
                      />
                      {renderVerificationTargets("Resolved targets", resolved)}
                      {renderVerificationTargets("Remaining targets", remaining)}
                      {task.result.complianceControls.length > 0 && (
                        <div className="space-y-1">
                          <p style={{ fontFamily: "monospace", fontSize: 9, color: "#6b7280", letterSpacing: 2 }}>
                            // RELATED COMPLIANCE CONTROLS
                          </p>
                          {task.result.complianceControls.map((control) => (
                            <p key={`${control.cloud}-${control.id}`} style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>
                              - [{control.cloud.toUpperCase()}] {control.standard} · {control.title} ({control.status})
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {showMoreInfo && (
              <div className="space-y-3">
                <button
                  onClick={() => toggleExpanded(task.id)}
                  className="inline-flex items-center gap-1 text-xs uppercase tracking-widest"
                  style={{ color: "var(--green)" }}
                >
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {isExpanded ? "Less Info" : "More Info"}
                </button>
                {isExpanded && (
                  <div className="space-y-2">
                    <p style={{ fontFamily: "monospace", fontSize: 9, color: "#6b7280", letterSpacing: 2 }}>
                      // ISSUES INCLUDED IN THIS REMEDIATION
                    </p>
                    {task.kind === "terraform_preview"
                      ? task.result && (
                        <div className="space-y-3">
                          {renderTargetDetails(
                            task.result.targets,
                            new Set((task.result.uncoveredTargets ?? []).map((target) => target.id))
                          )}
                          {renderFailures(task.result.failures ?? [])}
                        </div>
                      )
                      : task.kind === "terraform_pr"
                        ? task.result && (
                          <div className="space-y-3">
                            {renderTargetDetails(
                              task.result.targets,
                              new Set((task.result.uncoveredTargets ?? []).map((target) => target.id))
                            )}
                            {renderFailures(task.result.failures ?? [])}
                          </div>
                        )
                        : task.kind === "verify_fix" && task.result
                          ? (
                            <div className="space-y-3">
                              {renderVerificationTargets("Resolved targets", task.result.resolvedTargets ?? [])}
                              {renderVerificationTargets("Remaining targets", task.result.remainingTargets ?? [])}
                            </div>
                          )
                        : null}
                    {task.status === "completed" && (task.kind === "terraform_preview" || task.kind === "terraform_pr") && (task.result?.targets?.length ?? 0) > 0 && (
                      <button
                        onClick={() => startVerifyFix({
                          sourceTaskId: task.id,
                          sourceTaskKind: task.kind,
                          repoFullName: task.result!.repoFullName,
                          defaultBranch: task.result!.defaultBranch,
                          targets: task.result!.targets,
                        })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-widest"
                        style={{ border: "1px solid #6366f144", color: "#a78bfa", background: "#140f28" }}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Verify Fix
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {task.status === "completed" && (task.kind === "gcp_scan" || task.kind === "aws_scan" || task.kind === "attack_paths") && (
              <div className="flex items-center gap-2" style={{ color: "#22c55e" }}>
                <CheckCircle2 className="w-4 h-4" />
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                  Completed {task.result?.fetchedAt ? `at ${new Date(task.result.fetchedAt).toLocaleTimeString()}` : "successfully"}
                </span>
              </div>
            )}
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
