"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Terminal,
  RefreshCw,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Trash2,
  XCircle,
  RotateCcw,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import CopyTextButton from "@/components/CopyTextButton";
import { useDemoMode } from "@/components/DemoModeProvider";
import {
  buildCliCommandsForTask,
  type HandoffTaskRecord,
  type HandoffTaskStatus,
} from "@/lib/handoff/tasks";

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "open,claimed,in_progress", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

function statusStyle(status: HandoffTaskStatus): { color: string; border: string; bg: string } {
  switch (status) {
    case "completed":
      return { color: "#4ade80", border: "rgba(34,197,94,0.35)", bg: "rgba(34,197,94,0.08)" };
    case "in_progress":
    case "claimed":
      return { color: "#38bdf8", border: "rgba(56,189,248,0.35)", bg: "rgba(56,189,248,0.08)" };
    case "dismissed":
      return { color: "#94a3b8", border: "rgba(148,163,184,0.3)", bg: "rgba(148,163,184,0.06)" };
    default:
      return { color: "#fbbf24", border: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.08)" };
  }
}

export default function CliHandoffQueue() {
  const demoMode = useDemoMode();
  const [tasks, setTasks] = useState<HandoffTaskRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("open,claimed,in_progress");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTasks(filter = statusFilter) {
    if (demoMode) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/tasks?status=${encodeURIComponent(filter)}&limit=50`);
      const data = (await res.json().catch(() => ({}))) as { tasks?: HandoffTaskRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CLI handoff queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, demoMode]);

  async function updateStatus(taskId: string, status: HandoffTaskStatus) {
    setBusyId(taskId);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await loadTasks(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task.");
    } finally {
      setBusyId(null);
    }
  }

  async function verifyTask(taskId: string) {
    setBusyId(taskId);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoComplete: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await loadTasks(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify task.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTask(taskId: string) {
    setBusyId(taskId);
    setError(null);
    try {
      const res = await fetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task.");
    } finally {
      setBusyId(null);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <div
      className="mt-8 border p-5 space-y-4"
      style={{ borderColor: "var(--border-dim)", background: "rgba(4, 8, 12, 0.7)" }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-400 font-mono">
              // CLI & MCP Task Queue
            </h2>
          </div>
          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            Tasks pushed from Findings or Attack Paths for OpenCode, Claude Code, and Codex.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/dashboard/settings?tab=integrations"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono border border-slate-700 text-sky-300 hover:bg-slate-800"
          >
            <KeyRound className="w-3 h-3" />
            API & MCP Setup
          </Link>
          <button
            type="button"
            onClick={() => void loadTasks(statusFilter)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`px-2.5 py-1 text-[11px] font-mono border transition-colors ${
              statusFilter === f.id
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : "border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs font-mono text-red-400 border border-red-500/30 bg-red-500/10">
          {error}
        </div>
      )}

      {demoMode ? (
        <p className="text-xs font-mono text-amber-300/90">
          CLI Queue persistence is disabled in Demo mode. Use &ldquo;Send to CLI&rdquo; on Findings or Attack Paths to copy inline commands or download TASKS.md.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 py-4 text-xs font-mono text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading CLI handoff tasks...
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-6 text-center border border-dashed border-slate-800 text-xs font-mono text-slate-500">
          No CLI handoff tasks in this filter. Push issues using &ldquo;Send to CLI&rdquo; from Findings or Attack Paths.
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => {
            const st = statusStyle(task.status);
            const cmds = buildCliCommandsForTask({
              taskId: task.id,
              title: task.title,
              promptMarkdown: task.promptMarkdown,
              origin,
              mode: "mcp",
            });
            const primaryCmd =
              task.targetTool === "claude"
                ? cmds.claude
                : task.targetTool === "codex"
                  ? cmds.codex
                  : cmds.opencode;

            return (
              <div
                key={task.id}
                className="p-3.5 border border-slate-800 bg-slate-950/50 space-y-2"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-mono uppercase border"
                        style={{ color: st.color, borderColor: st.border, background: st.bg }}
                      >
                        {task.status}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 border border-slate-700 text-slate-300">
                        {task.severity}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        tool={task.targetTool} · {task.issueCount} issue{task.issueCount === 1 ? "" : "s"}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-300">{task.id}</span>
                    </div>
                    <p className="text-xs font-semibold text-white">{task.title}</p>
                    <p className="text-[11px] font-mono text-slate-500">
                      Updated {new Date(task.updatedAt).toLocaleString()}
                      {task.claimedBy ? ` · claimed by ${task.claimedBy}` : ""}
                      {task.sessionRef ? ` · session ${task.sessionRef}` : ""}
                    </p>
                    {task.payload?.lastVerification && (
                      <p className="text-[11px] font-mono text-cyan-300">
                        Verify: {task.payload.lastVerification.summary}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <CopyTextButton
                      text={primaryCmd}
                      label="Copy CLI Cmd"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800"
                    />
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void verifyTask(task.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                      title="Verify against Watchmen's latest snapshots"
                    >
                      <ShieldCheck className="w-3 h-3" />
                      Verify Fix
                    </button>
                    {task.prUrl && (
                      <a
                        href={task.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                      >
                        <ExternalLink className="w-3 h-3" />
                        PR
                      </a>
                    )}
                    {task.status !== "completed" && (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void updateStatus(task.id, "completed")}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Complete
                      </button>
                    )}
                    {task.status === "open" || task.status === "claimed" || task.status === "in_progress" ? (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void updateStatus(task.id, "dismissed")}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" />
                        Dismiss
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void updateStatus(task.id, "open")}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reopen
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void deleteTask(task.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      title="Delete task"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
