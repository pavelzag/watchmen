"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardCheck,
  RefreshCw,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComplianceReport, ComplianceCategory, ControlResult, ControlStatus, ControlImpact } from "@/lib/compliance/types";

// ── Config ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ControlStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  pass: {
    label: "PASS",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  fail: {
    label: "FAIL",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
  warning: {
    label: "WARN",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
};

const IMPACT_CONFIG: Record<ControlImpact, { label: string; color: string }> = {
  critical: { label: "Critical", color: "text-red-400" },
  high:     { label: "High",     color: "text-orange-400" },
  medium:   { label: "Medium",   color: "text-amber-400" },
  low:      { label: "Low",      color: "text-slate-400" },
};

// Control ID → resource page slug for evidence chip links
const CONTROL_RESOURCE_PAGE: Record<string, string> = {
  "CC6.1.a": "users",
  "CC6.1.b": "service-accounts",
  "CC6.3.a": "service-accounts",
  "CC6.3.b": "service-accounts",
  "CC6.3.c": "service-accounts",
  "CC6.6.a": "cloud-sql",
  "CC6.7.a": "firewall",
  "CC6.7.b": "firewall",
  "C1.1.a":  "buckets",
  "C1.1.b":  "secrets",
  "C1.1.c":  "cloud-run",
  "CC7.1.a": "clusters",
  "CC7.2.a": "vms",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function renderMd(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre class="bg-slate-900 border border-slate-700/50 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 overflow-x-auto my-2 whitespace-pre-wrap">${code.trim()}</pre>`
    )
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-sky-300 text-xs font-mono">$1</code>')
    .replace(/^### (.+)$/gm, '<p class="text-xs font-semibold text-slate-200 uppercase tracking-wider mt-3 mb-1">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="text-sm font-semibold text-slate-200 mt-3 mb-1">$1</p>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-200">$1</strong>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class="space-y-1 my-1">${m}</ul>`)
    .replace(/\n(?!<)/g, "<br />");
}

function exportCsv(report: ComplianceReport) {
  const rows = [
    ["Control ID", "Title", "Status", "Impact", "Affected Resources", "Remediation"],
    ...report.categories.flatMap((cat) =>
      cat.controls.map((c) => [
        c.id,
        c.title,
        c.status,
        c.impact,
        c.evidence.map((e) => `${e.name} (${e.projectId})`).join("; "),
        c.remediationHint,
      ])
    ),
  ];
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soc2-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171";

  return (
    <svg width="100" height="100" viewBox="0 0 100 100" className="rotate-[-90deg]">
      <circle cx="50" cy="50" r={radius} strokeWidth="8" className="stroke-slate-800" fill="none" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        strokeWidth="8"
        fill="none"
        stroke={color}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function StatusBadge({ status }: { status: ControlStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border tracking-wide", cfg.color, cfg.bg, cfg.border)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

interface RecState {
  loading: boolean;
  text: string | null;
  error: string | null;
}

function ControlCard({ control }: { control: ControlResult }) {
  const [rec, setRec] = useState<RecState>({ loading: false, text: null, error: null });
  const [open, setOpen] = useState(false);
  const statusCfg = STATUS_CONFIG[control.status];
  const impactCfg = IMPACT_CONFIG[control.impact];
  const resourcePage = CONTROL_RESOURCE_PAGE[control.id];

  async function askAI() {
    setRec({ loading: true, text: null, error: null });
    setOpen(true);
    try {
      const res = await fetch("/api/compliance/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: control.id,
          title: control.title,
          description: control.description,
          evidence: control.evidence,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRec({ loading: false, text: data.recommendation, error: null });
    } catch (e) {
      setRec({ loading: false, text: null, error: e instanceof Error ? e.message : "Error" });
    }
  }

  return (
    <div className={cn("rounded-xl border glass", statusCfg.border)}>
      <div className="p-4 space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={control.status} />
            <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700/60 text-slate-300">
              {control.id}
            </span>
            <span className={cn("text-xs font-medium", impactCfg.color)}>
              {impactCfg.label} impact
            </span>
          </div>
        </div>

        {/* Title + description */}
        <p className="text-sm font-semibold text-white">{control.title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{control.description}</p>

        {/* Evidence chips */}
        {control.evidence.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {control.evidence.slice(0, 6).map((e, i) =>
              resourcePage ? (
                <Link
                  key={i}
                  href={`/dashboard/${resourcePage}?search=${encodeURIComponent(e.name)}`}
                  className="px-2 py-0.5 rounded-md text-xs bg-slate-800 border border-slate-700/60 text-slate-300 hover:text-white hover:border-slate-500 transition-colors font-mono"
                >
                  {e.name}
                </Link>
              ) : (
                <span key={i} className="px-2 py-0.5 rounded-md text-xs bg-slate-800 border border-slate-700/60 text-slate-300 font-mono">
                  {e.name}
                </span>
              )
            )}
            {control.evidence.length > 6 && (
              <span className="px-2 py-0.5 rounded-md text-xs bg-slate-800 border border-slate-700/60 text-slate-500">
                +{control.evidence.length - 6} more
              </span>
            )}
          </div>
        )}

        {/* Remediation hint */}
        {control.status !== "pass" && (
          <div className="pt-1 border-t border-slate-700/50">
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-400">Hint: </span>
              {control.remediationHint}
            </p>
          </div>
        )}
      </div>

      {/* AI section */}
      <div className="border-t border-slate-700/50">
        <div className="px-4 py-2 flex items-center justify-between gap-2">
          <button
            onClick={rec.text ? () => setOpen((o) => !o) : askAI}
            disabled={rec.loading}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium transition-all duration-150 rounded-lg px-2.5 py-1",
              rec.loading
                ? "text-slate-500 cursor-not-allowed"
                : rec.text
                ? "text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/15"
                : "text-slate-400 hover:text-violet-400 hover:bg-violet-500/10"
            )}
          >
            {rec.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {rec.loading ? "Asking AI…" : rec.text ? "AI Recommendation" : "Ask AI"}
          </button>
          {rec.text && (
            <button onClick={() => setOpen((o) => !o)} className="text-slate-500 hover:text-slate-300 transition-colors">
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {rec.error && (
          <div className="px-4 pb-3 flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {rec.error}
          </div>
        )}

        {rec.text && open && (
          <div className="px-4 pb-4 border-t border-slate-700/30">
            <div
              className="mt-3 text-xs text-slate-300 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMd(rec.text) }}
            />
            <button
              onClick={askAI}
              disabled={rec.loading}
              className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-violet-400 transition-colors"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Regenerate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CategorySection({ category }: { category: ComplianceCategory }) {
  const total = category.controls.length;
  const passing = category.controls.filter((c) => c.status === "pass").length;
  const score = total === 0 ? 100 : Math.round((passing / total) * 100);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-3">
      {/* Category header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-700 text-slate-200 shrink-0">
            {category.id}
          </span>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-white truncate">{category.name}</p>
            <p className="text-xs text-slate-500 hidden sm:block truncate">{category.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Score bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  score >= 80 ? "bg-emerald-400" : score >= 60 ? "bg-amber-400" : "bg-red-400"
                )}
                style={{ width: `${score}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 font-mono w-8 text-right">{score}%</span>
          </div>
          <span className="text-xs text-slate-500">{passing}/{total}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </button>

      {/* Controls */}
      {expanded && (
        <div className="space-y-2 pl-2">
          {category.controls.map((control) => (
            <ControlCard key={control.id} control={control} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load compliance report");
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const scoreColor = report
    ? report.score >= 80
      ? "text-emerald-400"
      : report.score >= 60
      ? "text-amber-400"
      : "text-red-400"
    : "text-slate-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold text-white">SOC 2 Type II</h1>
          {report && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
              {report.totalControls} controls
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <button
              onClick={() => exportCsv(report)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {report && (
        <p className="text-xs text-slate-600">
          Generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">{error}</p>
      )}

      {/* Score card */}
      {loading && (
        <div className="glass rounded-2xl p-6 animate-pulse">
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-slate-700" />
            <div className="space-y-2">
              <div className="h-8 w-20 bg-slate-700 rounded" />
              <div className="h-4 w-40 bg-slate-700 rounded" />
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="glass rounded-2xl p-6 border border-slate-700/50">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Ring + score */}
            <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
              <ScoreRing score={report.score} />
              <span className={cn("absolute text-2xl font-bold tabular-nums", scoreColor)}>
                {report.score}
              </span>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <div>
                <p className={cn("text-3xl font-bold tabular-nums", scoreColor)}>{report.score}%</p>
                <p className="text-sm text-slate-400 mt-0.5">Compliance Score</p>
              </div>
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {report.passingControls} passing
                </span>
                <span className="flex items-center gap-1.5 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {report.failingControls} failing
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {report.warningControls} warnings
                </span>
              </div>
            </div>

            {/* Quick summary */}
            {report.failingControls > 0 && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 shrink-0">
                <span className="font-semibold">{report.failingControls} control{report.failingControls !== 1 ? "s" : ""}</span>
                {" "}require{report.failingControls === 1 ? "s" : ""} immediate attention
              </div>
            )}
          </div>
        </div>
      )}

      {/* Categories */}
      {!loading && report && (
        <div className="space-y-4">
          {report.categories.map((cat) => (
            <CategorySection key={cat.id} category={cat} />
          ))}
        </div>
      )}

      {/* Skeleton for categories */}
      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass rounded-xl p-4 animate-pulse space-y-3">
              <div className="h-4 w-48 bg-slate-700 rounded" />
              <div className="space-y-2">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-3 w-full bg-slate-700/60 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
