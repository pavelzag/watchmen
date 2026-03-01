"use client";

import { useEffect, useState, useCallback } from "react";
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
  Shield,
  Printer,
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
  suppressed: {
    label: "SUPPRESSED",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    dot: "bg-slate-500",
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
  // SOC 2
  "CC6.1.a": "users",
  "CC6.1.b": "service-accounts",
  "CC6.3.a": "service-accounts",
  "CC6.3.b": "service-accounts",
  "CC6.3.c": "service-accounts",
  "CC6.3.d": "clusters",
  "CC6.6.a": "cloud-sql",
  "CC6.7.a": "firewall",
  "CC6.7.b": "firewall",
  "CC6.7.c": "cloud-sql",
  "C1.1.a":  "buckets",
  "C1.1.b":  "secrets",
  "C1.1.c":  "cloud-run",
  "CC7.1.a": "clusters",
  "CC7.1.b": "clusters",
  "CC7.2.a": "vms",
  "A1.2.a":  "cloud-sql",
  "A1.2.b":  "buckets",
  // ISO 27001
  "A.5.15.a": "users",
  "A.5.16.a": "service-accounts",
  "A.5.17.a": "service-accounts",
  "A.5.17.b": "clusters",
  "A.5.18.a": "service-accounts",
  "A.8.2.a":  "service-accounts",
  "A.8.3.a":  "buckets",
  "A.8.5.a":  "secrets",
  "A.8.5.b":  "cloud-run",
  "A.8.8.a":  "clusters",
  "A.8.14.a": "cloud-sql",
  "A.8.14.b": "buckets",
  "A.8.20.a": "firewall",
  "A.8.20.b": "firewall",
  "A.8.20.c": "vms",
  "A.8.20.d": "clusters",
  "A.8.21.a": "cloud-sql",
  "A.8.24.a": "cloud-sql",
};

// ── Reference links ───────────────────────────────────────────────────────

const AICPA_SOC2_PAGE = "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2";
const AICPA_TSC_PDF   = "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022";

const SOC2_AICPA_URL: Record<string, string> = {
  "CC6.1": AICPA_SOC2_PAGE,
  "CC6.3": AICPA_SOC2_PAGE,
  "CC6.6": AICPA_SOC2_PAGE,
  "CC6.7": AICPA_SOC2_PAGE,
  "C1.1":  AICPA_TSC_PDF,
  "CC7.1": AICPA_SOC2_PAGE,
  "CC7.2": AICPA_SOC2_PAGE,
  "A1.2":  AICPA_SOC2_PAGE,
};

const ISMS_BASE = "https://www.isms.online/iso-27001/annex-a-2022";

const ISO27001_URL: Record<string, string> = {
  "A.5.15": `${ISMS_BASE}/5-15-access-control-2022/`,
  "A.5.16": `${ISMS_BASE}/5-16-identity-management-2022/`,
  "A.5.17": `${ISMS_BASE}/5-17-authentication-information-2022/`,
  "A.5.18": `${ISMS_BASE}/5-18-access-rights-2022/`,
  "A.8.2":  `${ISMS_BASE}/8-2-privileged-access-rights-2022/`,
  "A.8.3":  `${ISMS_BASE}/8-3-information-access-restriction-2022/`,
  "A.8.5":  `${ISMS_BASE}/8-5-secure-authentication-2022/`,
  "A.8.8":  `${ISMS_BASE}/8-8-management-of-technical-vulnerabilities-2022/`,
  "A.8.14": `${ISMS_BASE}/8-14-redundancy-of-information-processing-facilities-2022/`,
  "A.8.20": `${ISMS_BASE}/8-20-networks-security-2022/`,
  "A.8.21": `${ISMS_BASE}/8-21-security-of-network-services-2022/`,
  "A.8.24": `${ISMS_BASE}/8-24-use-of-cryptography-2022/`,
};

function controlRefUrl(controlId: string, standard: Standard): string | undefined {
  const base = controlId.replace(/\.[a-z]$/, "");
  return standard === "soc2" ? SOC2_AICPA_URL[base] : ISO27001_URL[base];
}

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
  a.download = `${report.standard.replace(/\s+/g, "-").toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}.csv`;
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

// ── Score Trend Chart ─────────────────────────────────────────────────────

interface HistoryPoint { score: number; recorded_at: string }

function ScoreTrendChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;

  const W = 400;
  const H = 80;
  const PAD = { t: 8, r: 8, b: 20, l: 28 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const scores = history.map((h) => h.score);
  const minScore = Math.max(0, Math.min(...scores) - 10);
  const maxScore = Math.min(100, Math.max(...scores) + 10);

  const toX = (i: number) => PAD.l + (i / (history.length - 1)) * chartW;
  const toY = (s: number) => PAD.t + chartH - ((s - minScore) / (maxScore - minScore)) * chartH;

  const points = history.map((h, i) => `${toX(i)},${toY(h.score)}`).join(" ");
  const lastScore = scores[scores.length - 1];
  const fillColor = lastScore >= 80 ? "#34d399" : lastScore >= 60 ? "#fbbf24" : "#f87171";
  const fillId = `score-fill-${lastScore}`;

  // Close path for filled area
  const areaPoints = `${PAD.l},${PAD.t + chartH} ${points} ${toX(history.length - 1)},${PAD.t + chartH}`;

  const firstDate = new Date(history[0].recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastDate = new Date(history[history.length - 1].recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/50">
      <p className="text-xs text-slate-500 mb-2">Score trend (last {history.length} snapshots)</p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="max-h-20">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Y-axis labels */}
        {[minScore, maxScore].map((v, i) => (
          <text key={i} x={PAD.l - 4} y={toY(v) + 3} fontSize="7" fill="#64748b" textAnchor="end">
            {v}
          </text>
        ))}
        {/* X-axis labels */}
        <text x={PAD.l} y={H - 4} fontSize="7" fill="#64748b">{firstDate}</text>
        <text x={W - PAD.r} y={H - 4} fontSize="7" fill="#64748b" textAnchor="end">{lastDate}</text>
        {/* Fill area */}
        <polygon points={areaPoints} fill={`url(#${fillId})`} />
        {/* Line */}
        <polyline points={points} fill="none" stroke={fillColor} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle cx={toX(history.length - 1)} cy={toY(lastScore)} r="3" fill={fillColor} />
      </svg>
    </div>
  );
}

// ── Per-project violation breakdown ──────────────────────────────────────

function ProjectBreakdown({ report }: { report: ComplianceReport }) {
  const counts = new Map<string, number>();
  for (const cat of report.categories) {
    for (const ctrl of cat.controls) {
      if (ctrl.status === "fail" || ctrl.status === "warning") {
        for (const ev of ctrl.evidence) {
          counts.set(ev.projectId, (counts.get(ev.projectId) ?? 0) + 1);
        }
      }
    }
  }
  if (counts.size === 0) return null;

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0][1];

  return (
    <div className="glass rounded-2xl p-5 border border-slate-700/50 space-y-3">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Violations by Project</p>
      <div className="space-y-2">
        {sorted.map(([projectId, count]) => (
          <div key={projectId} className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-400 w-36 truncate shrink-0">{projectId}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-500/60"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 tabular-nums w-6 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ControlCard ───────────────────────────────────────────────────────────

interface RecState { loading: boolean; text: string | null; error: string | null }
interface SuppressState { open: boolean; justification: string; saving: boolean }

function ControlCard({
  control,
  standard,
  onSuppressed,
  onRevoked,
}: {
  control: ControlResult;
  standard: Standard;
  onSuppressed: (id: string, justification: string) => void;
  onRevoked: (id: string) => void;
}) {
  const [rec, setRec] = useState<RecState>({ loading: false, text: null, error: null });
  const [open, setOpen] = useState(false);
  const [suppress, setSuppress] = useState<SuppressState>({ open: false, justification: "", saving: false });

  const statusCfg = STATUS_CONFIG[control.status];
  const impactCfg = IMPACT_CONFIG[control.impact];
  const resourcePage = CONTROL_RESOURCE_PAGE[control.id];
  const refUrl = controlRefUrl(control.id, standard);

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
          standard: standard === "iso27001" ? "ISO 27001:2022" : "SOC 2 Type II",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRec({ loading: false, text: data.recommendation, error: null });
    } catch (e) {
      setRec({ loading: false, text: null, error: e instanceof Error ? e.message : "Error" });
    }
  }

  async function confirmSuppress() {
    setSuppress((s) => ({ ...s, saving: true }));
    try {
      const res = await fetch("/api/compliance/suppress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId: control.id, justification: suppress.justification }),
      });
      if (!res.ok) throw new Error("Failed to suppress");
      onSuppressed(control.id, suppress.justification);
      setSuppress({ open: false, justification: "", saving: false });
    } catch {
      setSuppress((s) => ({ ...s, saving: false }));
    }
  }

  async function revokeSuppress() {
    try {
      const res = await fetch("/api/compliance/suppress", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId: control.id }),
      });
      if (!res.ok) throw new Error("Failed to revoke");
      onRevoked(control.id);
    } catch {
      // silently ignore
    }
  }

  return (
    <div className={cn("rounded-xl border glass", statusCfg.border)}>
      <div className="p-4 space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={control.status} />
            {refUrl ? (
              <a
                href={refUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={standard === "iso27001" ? "View ISO 27001:2022 Annex A control" : "View AICPA Trust Services Criteria"}
                className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700/60 text-slate-300 hover:bg-slate-600/60 hover:text-white transition-colors underline decoration-slate-600 underline-offset-2"
              >
                {control.id}
              </a>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700/60 text-slate-300">
                {control.id}
              </span>
            )}
            <span className={cn("text-xs font-medium", impactCfg.color)}>
              {impactCfg.label} impact
            </span>
          </div>
        </div>

        {/* Title + description */}
        <p className="text-sm font-semibold text-white">{control.title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{control.description}</p>

        {/* Suppression justification */}
        {control.status === "suppressed" && control.justification && (
          <p className="text-xs text-slate-500 italic border-l-2 border-slate-600 pl-2">
            Justification: {control.justification}
          </p>
        )}

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
        {control.status !== "pass" && control.status !== "suppressed" && (
          <div className="pt-1 border-t border-slate-700/50">
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-400">Hint: </span>
              {control.remediationHint}
            </p>
          </div>
        )}

        {/* Risk acceptance form */}
        {control.status !== "pass" && (
          <div className="pt-1">
            {control.status === "suppressed" ? (
              <button
                onClick={revokeSuppress}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                <Shield className="w-3 h-3" />
                Revoke suppression
              </button>
            ) : suppress.open ? (
              <div className="space-y-2 pt-1">
                <textarea
                  value={suppress.justification}
                  onChange={(e) => setSuppress((s) => ({ ...s, justification: e.target.value }))}
                  placeholder="Justification for accepting this risk…"
                  rows={2}
                  className="w-full text-xs bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-slate-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={confirmSuppress}
                    disabled={suppress.saving}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors disabled:opacity-50"
                  >
                    {suppress.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    Confirm
                  </button>
                  <button
                    onClick={() => setSuppress({ open: false, justification: "", saving: false })}
                    className="text-xs px-2.5 py-1 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setSuppress((s) => ({ ...s, open: true }))}
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                <Shield className="w-3 h-3" />
                Accept risk
              </button>
            )}
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

// ── Filter types ──────────────────────────────────────────────────────────

type StatusFilter = "all" | "fail" | "warning" | "suppressed";

function CategorySection({
  category,
  standard,
  filter,
  onSuppressed,
  onRevoked,
}: {
  category: ComplianceCategory;
  standard: Standard;
  filter: StatusFilter;
  onSuppressed: (id: string, justification: string) => void;
  onRevoked: (id: string) => void;
}) {
  const visibleControls = filter === "all"
    ? category.controls
    : category.controls.filter((c) => c.status === filter);

  const total = category.controls.length;
  const passing = category.controls.filter((c) => c.status === "pass" || c.status === "suppressed").length;
  const score = total === 0 ? 100 : Math.round((passing / total) * 100);
  const [expanded, setExpanded] = useState(true);

  if (visibleControls.length === 0) return null;

  return (
    <div className="space-y-3">
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

      {expanded && (
        <div className="space-y-2 pl-2">
          {visibleControls.map((control) => (
            <ControlCard
              key={control.id}
              control={control}
              standard={standard}
              onSuppressed={onSuppressed}
              onRevoked={onRevoked}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

type Standard = "soc2" | "iso27001";

const STANDARDS: { id: Standard; label: string; sublabel: string }[] = [
  { id: "soc2",      label: "SOC 2",       sublabel: "Type II" },
  { id: "iso27001",  label: "ISO 27001",   sublabel: "2022" },
];

export default function CompliancePage() {
  const [standard, setStandard] = useState<Standard>("soc2");
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  async function load(std: Standard = standard) {
    setLoading(true);
    setError(null);
    setReport(null);
    setHistory([]);
    try {
      const [reportRes, historyRes] = await Promise.allSettled([
        fetch(`/api/compliance?standard=${std}`).then((r) => r.json()),
        fetch(`/api/compliance/history?standard=${std}`).then((r) => r.json()),
      ]);
      if (reportRes.status === "rejected") throw new Error("Failed to load compliance report");
      const data = reportRes.value;
      if (data.error) throw new Error(data.error);
      setReport(data);
      if (historyRes.status === "fulfilled" && Array.isArray(historyRes.value)) {
        setHistory(historyRes.value);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(standard); }, [standard]);

  // Optimistic suppression updates
  const handleSuppressed = useCallback((controlId: string, justification: string) => {
    setReport((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        categories: prev.categories.map((cat) => ({
          ...cat,
          controls: cat.controls.map((c) =>
            c.id === controlId ? { ...c, status: "suppressed" as ControlStatus, justification } : c
          ),
        })),
      };
      const all = updated.categories.flatMap((c) => c.controls);
      const passing = all.filter((c) => c.status === "pass").length;
      const failing = all.filter((c) => c.status === "fail").length;
      const warning = all.filter((c) => c.status === "warning").length;
      const suppressed = all.filter((c) => c.status === "suppressed").length;
      const score = updated.totalControls === 0
        ? 100
        : Math.round(((passing + suppressed + warning * 0.5) / updated.totalControls) * 100);
      return { ...updated, passingControls: passing, failingControls: failing, warningControls: warning, suppressedControls: suppressed, score };
    });
  }, []);

  const handleRevoked = useCallback((controlId: string) => {
    // Reload to get original status from server
    load(standard);
  }, [standard]);

  const allControls = report?.categories.flatMap((c) => c.controls) ?? [];
  const filterCounts: Record<StatusFilter, number> = {
    all: allControls.length,
    fail: allControls.filter((c) => c.status === "fail").length,
    warning: allControls.filter((c) => c.status === "warning").length,
    suppressed: allControls.filter((c) => c.status === "suppressed").length,
  };

  const scoreColor = report
    ? report.score >= 80 ? "text-emerald-400" : report.score >= 60 ? "text-amber-400" : "text-red-400"
    : "text-slate-400";

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap print:hidden">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold text-white">Compliance</h1>
          {report && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
              {report.totalControls} controls
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <>
              <button
                onClick={() => exportCsv(report)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800"
              >
                <Printer className="w-3.5 h-3.5" />
                Export PDF
              </button>
            </>
          )}
          <button
            onClick={() => load(standard)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Standard tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-800/60 border border-slate-700/50 w-fit print:hidden">
        {STANDARDS.map((s) => (
          <button
            key={s.id}
            onClick={() => { setStandard(s.id); setFilter("all"); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              standard === s.id
                ? "bg-slate-700 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {s.label}
            <span className={cn(
              "text-[10px] px-1 py-0.5 rounded font-mono",
              standard === s.id ? "bg-slate-600 text-slate-300" : "text-slate-600"
            )}>
              {s.sublabel}
            </span>
          </button>
        ))}
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
                <p className="text-sm text-slate-400 mt-0.5">
                  {report.standard} Compliance Score
                </p>
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
                {report.suppressedControls > 0 && (
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-slate-500" />
                    {report.suppressedControls} suppressed
                  </span>
                )}
              </div>
            </div>

            {report.failingControls > 0 && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 shrink-0">
                <span className="font-semibold">{report.failingControls} control{report.failingControls !== 1 ? "s" : ""}</span>
                {" "}require{report.failingControls === 1 ? "s" : ""} immediate attention
              </div>
            )}
          </div>

          {/* Score trend chart */}
          <ScoreTrendChart history={history} />
        </div>
      )}

      {/* Filter tabs */}
      {report && !loading && (
        <div className="flex items-center gap-1 flex-wrap print:hidden">
          {(["all", "fail", "warning", "suppressed"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                filter === f
                  ? f === "fail"
                    ? "bg-red-500/15 text-red-400 border-red-500/30"
                    : f === "warning"
                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    : f === "suppressed"
                    ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                    : "bg-slate-700 text-white border-slate-600"
                  : "text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600"
              )}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="text-[10px] font-mono opacity-70">{filterCounts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Categories */}
      {!loading && report && (
        <div className="space-y-4">
          {report.categories.map((cat) => (
            <CategorySection
              key={cat.id}
              category={cat}
              standard={standard}
              filter={filter}
              onSuppressed={handleSuppressed}
              onRevoked={handleRevoked}
            />
          ))}
        </div>
      )}

      {/* Per-project breakdown */}
      {!loading && report && <ProjectBreakdown report={report} />}

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
