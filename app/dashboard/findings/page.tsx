"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot, SecurityFinding, SecurityFindingSeverity } from "@/lib/gcp/types";

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

function SeverityBadge({ severity }: { severity: SecurityFindingSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border", cfg.color, cfg.bg, cfg.border)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/snapshot");
      if (!res.ok) throw new Error("Failed to load GCP data");
      const snap: GcpSnapshot = await res.json();
      setFindings(computeFindings(snap));
      setFetchedAt(snap.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const severities: SecurityFindingSeverity[] = ["critical", "high", "medium", "low"];

  const counts = {
    all: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const displayed = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
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
              {counts.all} total
            </span>
          )}
        </div>
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
                    ? cn(cfg.color, cfg.bg, cfg.border)
                    : "bg-slate-700 text-white border-slate-600"
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
          <p className="text-slate-500 text-sm mt-1">Your GCP environment looks clean based on the current snapshot.</p>
        </div>
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
                <div
                  key={finding.id}
                  className={cn("rounded-xl p-4 border glass space-y-2", cfg.border)}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SeverityBadge severity={finding.severity} />
                      <span className="text-xs text-slate-500 font-mono">{finding.resourceType}</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300 font-mono shrink-0">
                      {finding.projectId}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">{finding.title}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{finding.description}</p>
                  {finding.remediationHint && (
                    <div className="pt-1 border-t border-slate-700/50">
                      <p className="text-xs text-slate-500">
                        <span className="font-semibold text-slate-400">Remediation: </span>
                        {finding.remediationHint}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
