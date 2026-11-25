"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Terminal, X, Download, Send, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Shield, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import CopyTextButton from "@/components/CopyTextButton";
import { useDemoMode } from "@/components/DemoModeProvider";
import {
  buildCliCommandsForTask,
  buildHandoffTaskDrafts,
  buildTasksMarkdownPack,
  type HandoffBatchMode,
  type HandoffIssueItem,
  type HandoffRemediationMode,
  type HandoffTaskRecord,
  type HandoffTool,
} from "@/lib/handoff/tasks";
import type { SecurityFindingSeverity } from "@/lib/gcp/types";

const SEVERITY_LEVELS: SecurityFindingSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_CHIP_STYLE: Record<SecurityFindingSeverity, { active: string; label: string }> = {
  critical: { active: "border-red-500/60 bg-red-500/15 text-red-300", label: "Critical" },
  high: { active: "border-orange-500/60 bg-orange-500/15 text-orange-300", label: "High" },
  medium: { active: "border-amber-500/60 bg-amber-500/15 text-amber-300", label: "Medium" },
  low: { active: "border-slate-500/60 bg-slate-500/15 text-slate-200", label: "Low" },
};

function defaultSelectedSeverities(issues: HandoffIssueItem[]): SecurityFindingSeverity[] {
  const hasHighImpact = issues.some(
    (i) => i.severity === "critical" || i.severity === "high" || i.severity === "medium"
  );
  if (issues.length > 100 && hasHighImpact) {
    return ["critical", "high", "medium"];
  }
  return [...SEVERITY_LEVELS];
}

interface PushToCliModalProps {
  isOpen: boolean;
  onClose: () => void;
  issues: HandoffIssueItem[];
  contextLabel?: string;
  defaultRemediationMode?: HandoffRemediationMode;
}

const REMEDIATION_MODE_OPTIONS: Array<{ id: HandoffRemediationMode; label: string; desc: string }> = [
  { id: "iac", label: "IaC / Code Fix", desc: "Terraform, Kubernetes manifests, or Dockerfile updates" },
  { id: "shirudo_shield", label: "Shirudo Live Shield", desc: "Signed eBPF / Java upatch + Beefile (no restart)" },
];

const TOOL_OPTIONS: Array<{ id: HandoffTool; label: string; hint: string }> = [
  { id: "opencode", label: "OpenCode", hint: "opencode run" },
  { id: "claude", label: "Claude Code", hint: "claude / claude -p" },
  { id: "codex", label: "Codex", hint: "codex / codex exec" },
  { id: "any", label: "Any / API", hint: "curl / Markdown" },
];

const BATCH_OPTIONS: Array<{ id: HandoffBatchMode; label: string; desc: string }> = [
  { id: "grouped", label: "Grouped by category", desc: "Splits into focused batches (IAM, Firewall, Storage, etc.)" },
  { id: "combined", label: "Single combined task", desc: "Packages all selected issues into one prompt" },
  { id: "individual", label: "One task per issue", desc: "Creates a separate task for each individual issue" },
];

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PushToCliModal({
  isOpen,
  onClose,
  issues,
  contextLabel = "Security Issues",
  defaultRemediationMode = "iac",
}: PushToCliModalProps) {
  const demoMode = useDemoMode();
  const [targetTool, setTargetTool] = useState<HandoffTool>("opencode");
  const [batchMode, setBatchMode] = useState<HandoffBatchMode>("grouped");
  const [remediationMode, setRemediationMode] = useState<HandoffRemediationMode>(defaultRemediationMode);
  const [selectedSeverities, setSelectedSeverities] = useState<SecurityFindingSeverity[]>(() =>
    defaultSelectedSeverities(issues)
  );
  const [commandMode, setCommandMode] = useState<"mcp" | "api" | "inline">("mcp");
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushedTasks, setPushedTasks] = useState<HandoffTaskRecord[] | null>(null);
  const [pushStats, setPushStats] = useState<{ createdCount: number; updatedCount: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRemediationMode(defaultRemediationMode);
  }, [isOpen, defaultRemediationMode]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedSeverities(defaultSelectedSeverities(issues));
  }, [isOpen, issues]);

  useEffect(() => {
    if (!isOpen) return;
    setPushError(null);
    setPushedTasks(null);
    setPushStats(null);
  }, [isOpen, issues.length, batchMode, targetTool, remediationMode, selectedSeverities]);

  const severityCounts = useMemo(() => {
    const counts: Record<SecurityFindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of issues) {
      counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
    }
    return counts;
  }, [issues]);

  const filteredIssues = useMemo(
    () => issues.filter((issue) => selectedSeverities.includes(issue.severity)),
    [issues, selectedSeverities]
  );

  const drafts = useMemo(
    () => buildHandoffTaskDrafts({ issues: filteredIssues, batchMode, targetTool, remediationMode }),
    [filteredIssues, batchMode, targetTool, remediationMode]
  );

  if (!isOpen) return null;

  function toggleSeverity(sev: SecurityFindingSeverity) {
    setSelectedSeverities((prev) =>
      prev.includes(sev) ? prev.filter((item) => item !== sev) : [...prev, sev]
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const activeTasks = pushedTasks ?? drafts.map((d, idx) => ({
    id: undefined as string | undefined,
    title: d.title,
    severity: d.severity,
    issueCount: d.issueCount,
    promptMarkdown: d.promptMarkdown,
    key: `${d.fingerprint}-${idx}`,
  }));

  async function handlePushToQueue() {
    if (filteredIssues.length === 0 || pushing) return;
    setPushing(true);
    setPushError(null);
    try {
      const res = await fetch("/api/handoff/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues: filteredIssues, batchMode, targetTool, remediationMode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        tasks?: HandoffTaskRecord[];
        createdCount?: number;
        updatedCount?: number;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setPushedTasks(data.tasks ?? []);
      setPushStats({
        createdCount: data.createdCount ?? 0,
        updatedCount: data.updatedCount ?? 0,
      });
      setCommandMode("mcp");
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to push tasks.");
    } finally {
      setPushing(false);
    }
  }

  function handleDownloadMarkdown() {
    const items = (pushedTasks ?? drafts).map((item) => ({
      id: "id" in item && typeof item.id === "string" ? item.id : undefined,
      title: item.title,
      severity: item.severity,
      promptMarkdown: item.promptMarkdown,
    }));
    const md = buildTasksMarkdownPack(items);
    downloadBlob(md, `watchmen-tasks-${new Date().toISOString().slice(0, 10)}.md`, "text/markdown");
  }

  function handleDownloadJson() {
    const items = pushedTasks ?? drafts;
    downloadBlob(
      JSON.stringify({ version: "0.9", generatedAt: new Date().toISOString(), tasks: items }, null, 2),
      `watchmen-tasks-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json"
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-emerald-500/30 bg-[#05080d] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">
                Send {contextLabel} to CLI Task Queue
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                {filteredIssues.length === issues.length
                  ? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
                  : `${filteredIssues.length} of ${issues.length} issues`}{" "}
                → {drafts.length} task{drafts.length === 1 ? "" : "s"} · Watchmen v0.10
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Secret redaction notice */}
          <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs">
            <span className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Raw secret patterns (tokens, passwords, private keys) are automatically redacted before export.
            </span>
            <Link
              href="/dashboard/settings?tab=integrations"
              className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-300 hover:text-sky-200 underline"
            >
              <KeyRound className="w-3 h-3" />
              Manage CLI API Tokens
            </Link>
          </div>

          {/* Severity Filter */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-mono text-slate-400">
              Include Severities ({filteredIssues.length}/{issues.length} selected)
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {SEVERITY_LEVELS.map((sev) => {
                const count = severityCounts[sev];
                const active = selectedSeverities.includes(sev);
                const cfg = SEVERITY_CHIP_STYLE[sev];
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => toggleSeverity(sev)}
                    aria-pressed={active}
                    className={cn(
                      "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                      active
                        ? cfg.active
                        : "border-slate-800 bg-slate-900/40 text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {cfg.label} ({count})
                  </button>
                );
              })}
            </div>
            {issues.length > 100 && !selectedSeverities.includes("low") && severityCounts.low > 0 && (
              <div className="px-3 py-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200 font-mono">
                Large batch: {severityCounts.low} low-severity issues excluded by default so your MCP queue stays focused. Click &ldquo;Low ({severityCounts.low})&rdquo; to include them.
              </div>
            )}
          </div>

          {/* Remediation Mode */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-mono text-slate-400">Remediation Mode</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {REMEDIATION_MODE_OPTIONS.map((modeOpt) => (
                <button
                  key={modeOpt.id}
                  type="button"
                  onClick={() => setRemediationMode(modeOpt.id)}
                  className={cn(
                    "text-left px-3 py-2 rounded-lg border transition-colors",
                    remediationMode === modeOpt.id
                      ? modeOpt.id === "shirudo_shield"
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
                        : "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
                  )}
                >
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    {modeOpt.id === "shirudo_shield" && <Shield className="w-3.5 h-3.5 text-violet-400" />}
                    {modeOpt.label}
                  </div>
                  <div className="text-[10px] text-slate-400">{modeOpt.desc}</div>
                </button>
              ))}
            </div>
            {remediationMode === "shirudo_shield" && (
              <div className="px-3 py-2 rounded-lg border border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-200">
                Shirudo mode generates an eBPF or Java-agent <code>upatch</code> + <code>Beefile</code> task. ML-DSA-87 signing keys stay on your operator/CI host, and targets require a Shirudo-enabled Linux kernel + TPM 2.0.
              </div>
            )}
          </div>

          {/* Target CLI & Grouping */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-mono text-slate-400">Target CLI Tool</p>
              <div className="grid grid-cols-2 gap-2">
                {TOOL_OPTIONS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setTargetTool(tool.id)}
                    className={cn(
                      "text-left px-3 py-2 rounded-lg border transition-colors",
                      targetTool === tool.id
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
                        : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
                    )}
                  >
                    <div className="text-xs font-medium">{tool.label}</div>
                    <div className="text-[10px] font-mono text-slate-500">{tool.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-mono text-slate-400">Task Grouping</p>
              <div className="space-y-1.5">
                {BATCH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBatchMode(opt.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border transition-colors",
                      batchMode === opt.id
                        ? "border-sky-500/60 bg-sky-500/10 text-sky-200"
                        : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
                    )}
                  >
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="text-[10px] text-slate-400">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handlePushToQueue}
                disabled={demoMode || pushing || filteredIssues.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors",
                  demoMode || pushing || filteredIssues.length === 0
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                )}
              >
                {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {pushing ? "Pushing..." : pushedTasks ? "Re-sync Queue" : "Push to Watchmen Queue"}
              </button>

              <button
                type="button"
                onClick={handleDownloadMarkdown}
                disabled={drafts.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                TASKS.md
              </button>

              <button
                type="button"
                onClick={handleDownloadJson}
                disabled={drafts.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                JSON Pack
              </button>
            </div>

            {pushedTasks && (
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 p-0.5 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => setCommandMode("mcp")}
                  className={cn(
                    "px-2 py-1 rounded",
                    commandMode === "mcp" ? "bg-slate-800 text-emerald-300" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  MCP
                </button>
                <button
                  type="button"
                  onClick={() => setCommandMode("api")}
                  className={cn(
                    "px-2 py-1 rounded",
                    commandMode === "api" ? "bg-slate-800 text-emerald-300" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  REST API
                </button>
                <button
                  type="button"
                  onClick={() => setCommandMode("inline")}
                  className={cn(
                    "px-2 py-1 rounded",
                    commandMode === "inline" ? "bg-slate-800 text-emerald-300" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  Inline Prompt
                </button>
              </div>
            )}
          </div>

          {demoMode && (
            <p className="text-[11px] font-mono text-amber-300/90">
              Demo mode: server-side queue persistence is disabled, but you can copy inline CLI commands or download TASKS.md / JSON Pack directly.
            </p>
          )}

          {pushError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{pushError}</span>
            </div>
          )}

          {pushStats && (
            <div className="space-y-1.5 px-3 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Queued {pushedTasks?.length ?? 0} task{(pushedTasks?.length ?? 0) === 1 ? "" : "s"} ({pushStats.createdCount} created, {pushStats.updatedCount} updated).
                  Set <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">export WATCHMEN_API_TOKEN=wm_...</code> in your terminal.
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-300 pl-6">
                Auto-run locally in isolated worktrees: <code className="text-emerald-200">node scripts/watchmen-cli.mjs watch --tool {targetTool === "any" ? "opencode" : targetTool} --worktree --verify --once</code>
              </div>
            </div>
          )}

          {/* Task Previews / Queued Tasks */}
          <div className="space-y-3">
            {activeTasks.map((task, idx) => {
              const cmds = buildCliCommandsForTask({
                taskId: task.id,
                title: task.title,
                promptMarkdown: task.promptMarkdown,
                origin,
                mode: task.id ? commandMode : "inline",
              });
              const primaryCmd =
                targetTool === "opencode"
                  ? cmds.opencode
                  : targetTool === "claude"
                    ? cmds.claude
                    : targetTool === "codex"
                      ? cmds.codex
                      : cmds.curl;

              return (
                <div
                  key={"id" in task && task.id ? task.id : `draft-${idx}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
                        {task.severity}
                      </span>
                      <span className="text-xs font-semibold text-white truncate">{task.title}</span>
                      <span className="text-[11px] font-mono text-slate-500">
                        ({task.issueCount} issue{task.issueCount === 1 ? "" : "s"})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.id && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                          {task.id}
                        </span>
                      )}
                      <CopyTextButton text={task.promptMarkdown} label="Copy Prompt" className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 text-slate-300 hover:bg-slate-800" />
                    </div>
                  </div>

                  <div className="rounded border border-slate-800 bg-[#04060a] p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        {targetTool === "any" ? "API Fetch Command" : `${targetTool} command`}
                      </span>
                      <CopyTextButton text={primaryCmd} label="Copy Command" className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 text-slate-300 hover:bg-slate-800" />
                    </div>
                    <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all max-h-24">
                      {primaryCmd}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between text-[11px] font-mono text-slate-500">
          <span>API: GET/POST /api/handoff/tasks</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
