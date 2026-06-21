"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, ShieldCheck, RefreshCw, Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle, GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot, SecurityFinding, SecurityFindingSeverity } from "@/lib/gcp/types";
import { computeAwsFindings } from "@/lib/aws-findings";
import type { AwsSecurityFinding, AwsSnapshot } from "@/lib/aws/types";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";
import { linkifyText } from "@/lib/utils/linkify";
import type { ResourceItem } from "@/lib/claude/query-processor";
import RemediateModal from "@/app/dashboard/attack-paths/RemediateModal";
import ScanCloudButton from "@/components/ScanCloudButton";
import { remediationTargetFromFinding } from "@/lib/github/remediation-targets";

const SEVERITY_CONFIG: Record<SecurityFindingSeverity, { label: string; color: string; bg: string; border: string; dot: string }> = {
  critical: {
    label: "Critical",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
  high: {
    label: "High",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    dot: "bg-orange-400",
  },
  medium: {
    label: "Medium",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    dot: "bg-slate-400",
  },
};

type Filter = "all" | SecurityFindingSeverity;
type CloudFilter = "all" | "gcp" | "aws";
type CloudFinding = SecurityFinding & {
  cloud: "gcp" | "aws";
  region?: string;
};

function awsFindingToCloudFinding(finding: AwsSecurityFinding): CloudFinding {
  return {
    id: `aws:${finding.id}`,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    resourceName: finding.resourceName,
    projectId: finding.accountId,
    resourceType: finding.resourceType,
    remediationHint: finding.remediationHint,
    cloud: "aws",
    region: finding.region,
  };
}

function SeverityBadge({ severity }: { severity: SecurityFindingSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border", cfg.color, cfg.bg, cfg.border)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal markdown renderer for AI recommendations
function renderMd(text: string, finding: CloudFinding): string {
  // We manufacture a resource item for the primary finding resource to ensure it's always linkable
  const resources: ResourceItem[] = [
    { name: finding.resourceName, projectId: finding.projectId, type: finding.resourceType as any, cloud: finding.cloud }
  ];

  const html = escapeHtml(text)
    // Code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre class="bg-slate-900 border border-slate-700/50 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 overflow-x-auto my-2 whitespace-pre-wrap">${code}</pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-sky-300 text-xs font-mono">$1</code>')
    // ### Headers
    .replace(/^### (.+)$/gm, '<p class="text-xs font-semibold text-slate-200 uppercase tracking-wider mt-3 mb-1">$1</p>')
    // ## Headers
    .replace(/^## (.+)$/gm, '<p class="text-sm font-semibold text-slate-200 mt-3 mb-1">$1</p>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, "<strong class=\"text-slate-200\">$1</strong>")
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Bullet list items
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Wrap consecutive li elements
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class="space-y-1 my-1">${m}</ul>`)
    // Line breaks (non-header, non-list)
    .replace(/\n(?!<)/g, "<br />");

  return linkifyText(html, resources);
}

interface RecState {
  loading: boolean;
  text: string | null;
  error: string | null;
}

function FindingCard({ finding, cfg }: { finding: CloudFinding; cfg: typeof SEVERITY_CONFIG[SecurityFindingSeverity] }) {
  const [rec, setRec] = useState<RecState>({ loading: false, text: null, error: null });
  const [open, setOpen] = useState(false);
  const canAskAI = true;

  async function askAI() {
    setRec({ loading: true, text: null, error: null });
    setOpen(true);
    try {
      const res = await fetch("/api/findings/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...finding,
          demoCredentials: (() => {
            const browserAI = getActiveBrowserAIKey();
            return browserAI ? { aiKey: browserAI.key, aiProvider: browserAI.provider } : undefined;
          })(),
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
    <div data-nav tabIndex={0} className={cn("rounded-xl border glass space-y-2 group", cfg.border)}>
      {/* Main content */}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider",
              finding.cloud === "aws"
                ? "bg-orange-500/10 text-orange-300 border-orange-500/30"
                : "bg-sky-500/10 text-sky-300 border-sky-500/30"
            )}>
              {finding.cloud}
            </span>
            <SeverityBadge severity={finding.severity} />
            <span className="text-xs text-slate-500 font-mono">{finding.resourceType}</span>
            {finding.region && <span className="text-xs text-slate-600 font-mono">{finding.region}</span>}
          </div>
          <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300 font-mono shrink-0">
            {finding.projectId}
          </span>
        </div>
        <p className="text-sm font-semibold text-white uppercase tracking-tight flex items-center gap-2">
          {finding.title}
          {canAskAI && (
            <button onClick={askAI} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-violet-400" title="Explain with AI">
              <Sparkles className="w-3 h-3" />
            </button>
          )}
        </p>
        <p className="text-xs text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
          {finding.description}
        </p>
        {finding.remediationHint && (
          <div className="pt-1 border-t border-slate-700/50">
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-400">Hint: </span>
              {finding.remediationHint}
            </p>
          </div>
        )}
      </div>

      {/* AI recommendation area */}
      {canAskAI && (
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
            {rec.loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {rec.loading ? "Asking AI…" : rec.text ? "AI Recommendation" : "Ask AI"}
          </button>

          {rec.text && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              {open
                ? <ChevronUp className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Error */}
        {rec.error && (
          <div className="px-4 pb-3 flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {rec.error}
          </div>
        )}

        {/* Recommendation */}
        {rec.text && open && (
          <div className="px-4 pb-4 border-t border-slate-700/30">
            <div
              className="mt-3 text-xs text-slate-300 leading-relaxed prose-answer"
              dangerouslySetInnerHTML={{ __html: renderMd(rec.text, finding) }}
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
      )}
    </div>
  );
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<CloudFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [showRemediate, setShowRemediate] = useState(false);

  useEffect(() => {
    const cloud = new URLSearchParams(window.location.search).get("cloud");
    if (cloud === "gcp" || cloud === "aws") {
      setCloudFilter(cloud);
      setFilter("all");
    }
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [gcpResult, awsResult] = await Promise.allSettled([
        fetch("/api/gcp/snapshot"),
        fetch("/api/aws/snapshot"),
      ]);

      const nextFindings: CloudFinding[] = [];
      const fetchedAts: string[] = [];
      const errors: string[] = [];

      if (gcpResult.status === "fulfilled" && gcpResult.value.ok) {
        const snap: GcpSnapshot = await gcpResult.value.json();
        nextFindings.push(...computeFindings(snap).map((finding) => ({ ...finding, cloud: "gcp" as const })));
        if (snap.fetchedAt) fetchedAts.push(snap.fetchedAt);
      } else if (gcpResult.status === "rejected" || (gcpResult.status === "fulfilled" && gcpResult.value.status !== 404)) {
        errors.push("Failed to load GCP data");
      }

      if (awsResult.status === "fulfilled" && awsResult.value.ok) {
        const snap: AwsSnapshot = await awsResult.value.json();
        nextFindings.push(...computeAwsFindings(snap).map(awsFindingToCloudFinding));
        if (snap.fetchedAt) fetchedAts.push(snap.fetchedAt);
      } else if (awsResult.status === "rejected" || (awsResult.status === "fulfilled" && awsResult.value.status !== 404)) {
        errors.push("Failed to load AWS data");
      }

      setFindings(nextFindings);
      setFetchedAt(fetchedAts.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null);
      if (errors.length > 0 && nextFindings.length === 0) throw new Error(errors.join("; "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const severities: SecurityFindingSeverity[] = ["critical", "high", "medium", "low"];

  const cloudCounts = {
    all: findings.length,
    gcp: findings.filter((f) => f.cloud === "gcp").length,
    aws: findings.filter((f) => f.cloud === "aws").length,
  };

  const cloudFiltered = cloudFilter === "all" ? findings : findings.filter((f) => f.cloud === cloudFilter);
  const counts = {
    all: cloudFiltered.length,
    critical: cloudFiltered.filter((f) => f.severity === "critical").length,
    high: cloudFiltered.filter((f) => f.severity === "high").length,
    medium: cloudFiltered.filter((f) => f.severity === "medium").length,
    low: cloudFiltered.filter((f) => f.severity === "low").length,
  };

  const displayed = filter === "all" ? cloudFiltered : cloudFiltered.filter((f) => f.severity === filter);
  const gcpRemediableFindings = displayed.filter((f) => f.cloud === "gcp");
  const bySeverity = severities
    .map((sev) => ({
      severity: sev,
      items: displayed.filter((f) => f.severity === sev),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <h1 className="text-lg font-semibold text-white">Security Findings</h1>
          {!loading && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
              {findings.length} total
            </span>
          )}
        </div>
        {!loading && gcpRemediableFindings.length > 0 && (
          <button
            onClick={() => setShowRemediate(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-violet-500/40 text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            Fix GCP with GitHub PR
          </button>
        )}
        <ScanCloudButton onScanComplete={load} variant="modern" />
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {fetchedAt && (
        <p className="text-xs text-slate-600">
          Based on snapshot from {new Date(fetchedAt).toLocaleString()}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">{error}</p>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "all", label: "All clouds" },
          { key: "gcp", label: "GCP" },
          { key: "aws", label: "AWS" },
        ] as const).map((cloud) => (
          <button
            key={cloud.key}
            onClick={() => {
              setCloudFilter(cloud.key);
              setFilter("all");
              const url = new URL(window.location.href);
              if (cloud.key === "all") url.searchParams.delete("cloud");
              else url.searchParams.set("cloud", cloud.key);
              window.history.replaceState(null, "", url.toString());
            }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 uppercase tracking-wider",
              cloudFilter === cloud.key
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40 ring-1 ring-emerald-400/50 shadow-[0_0_18px_rgba(16,185,129,0.28)]"
                : "text-slate-400 bg-slate-800/40 border-slate-700/50 hover:border-slate-600"
            )}
          >
            {cloud.label} <span className="opacity-70">({cloudCounts[cloud.key]})</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", ...severities] as Filter[]).map((f) => {
          const cfg = f === "all" ? null : SEVERITY_CONFIG[f];
          const count = counts[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150",
                filter === f
                  ? cfg
                    ? cn(
                        cfg.color,
                        cfg.bg,
                        cfg.border,
                        f === "critical" && "ring-1 ring-red-400/60 shadow-[0_0_18px_rgba(248,113,113,0.30)]",
                        f === "high" && "ring-1 ring-orange-400/60 shadow-[0_0_18px_rgba(251,146,60,0.30)]",
                        f === "medium" && "ring-1 ring-amber-400/60 shadow-[0_0_18px_rgba(251,191,36,0.28)]",
                        f === "low" && "ring-1 ring-slate-300/60 shadow-[0_0_18px_rgba(148,163,184,0.28)]"
                      )
                    : "bg-slate-700 text-white border-slate-500 ring-1 ring-slate-300/50 shadow-[0_0_18px_rgba(148,163,184,0.24)]"
                  : "text-slate-400 bg-slate-800/40 border-slate-700/50 hover:border-slate-600"
              )}
            >
              {f === "all" ? "All" : SEVERITY_CONFIG[f].label}
              {" "}
              <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass rounded-xl p-4 animate-pulse space-y-2">
              <div className="h-3 w-24 bg-slate-700 rounded" />
              <div className="h-4 w-64 bg-slate-700 rounded" />
              <div className="h-3 w-full bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && findings.length === 0 && (
        <div className="text-center py-20">
          <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No security findings detected</p>
          <p className="text-slate-500 text-sm mt-1">Your cloud environments look clean based on the current snapshots.</p>
        </div>
      )}

      {!loading && findings.length > 0 && displayed.length === 0 && (
        <div className="text-center py-16">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No findings match the selected filters</p>
        </div>
      )}

      {showRemediate && (
        <RemediateModal
          targets={gcpRemediableFindings.map(remediationTargetFromFinding)}
          onClose={() => setShowRemediate(false)}
        />
      )}

      {!loading && bySeverity.map(({ severity, items }) => {
        const cfg = SEVERITY_CONFIG[severity];
        return (
          <div key={severity} className="space-y-2">
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border", cfg.bg, cfg.border)}>
              <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
              <span className={cn("text-xs font-semibold uppercase tracking-wider", cfg.color)}>
                {cfg.label} — {items.length} finding{items.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="space-y-2 pl-2">
              {items.map((finding) => (
                <FindingCard key={finding.id} finding={finding} cfg={cfg} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
