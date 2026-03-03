"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import { cn } from "@/lib/utils";
import { computeAwsFindings } from "@/lib/aws-findings";
import type { AwsSecurityFinding, AwsSnapshot } from "@/lib/aws/types";

const SEVERITY_CONFIG: Record<AwsSecurityFinding["severity"], { label: string; border: string; bg: string; text: string; badge: string }> = {
  critical: {
    label: "CRITICAL",
    border: "border-red-500/40",
    bg: "bg-red-500/5",
    text: "text-red-400",
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
  },
  high: {
    label: "HIGH",
    border: "border-orange-500/40",
    bg: "bg-orange-500/5",
    text: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  },
  medium: {
    label: "MEDIUM",
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/5",
    text: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  },
  low: {
    label: "LOW",
    border: "border-slate-500/40",
    bg: "bg-slate-500/5",
    text: "text-slate-400",
    badge: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  },
};

export default function AwsFindingsPage() {
  const [findings, setFindings] = useState<AwsSecurityFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap: AwsSnapshot) => {
        if (snap.iamUsers) {
          setFindings(computeAwsFindings(snap));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = findings.filter((f) => {
    const matchSearch =
      !search ||
      f.title.toLowerCase().includes(search.toLowerCase()) ||
      f.resourceName.toLowerCase().includes(search.toLowerCase()) ||
      f.accountId.toLowerCase().includes(search.toLowerCase());
    const matchSeverity = !severityFilter || f.severity === severityFilter;
    return matchSearch && matchSeverity;
  });

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const sortedFindings = [...filtered].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <DetailPageHeader
        title="AWS Security Findings"
        count={loading ? null : filtered.length}
        search={search}
        onSearch={setSearch}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Severity filter pills */}
      {!loading && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSeverityFilter("")}
            className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
              !severityFilter ? "border-slate-400 text-slate-200 bg-slate-700/40" : "border-slate-700 text-slate-500 hover:border-slate-500"
            )}
          >
            All ({findings.length})
          </button>
          {(["critical", "high", "medium", "low"] as const).map((sev) => {
            const cfg = SEVERITY_CONFIG[sev];
            const count = counts[sev];
            if (count === 0) return null;
            return (
              <button
                key={sev}
                onClick={() => setSeverityFilter(severityFilter === sev ? "" : sev)}
                className={cn(
                  "px-3 py-1 text-xs rounded-full border transition-colors",
                  severityFilter === sev ? cfg.badge : "border-slate-700 text-slate-500 hover:border-slate-500"
                )}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-700/40 p-4 animate-pulse space-y-2">
              <div className="h-4 bg-slate-700 rounded w-1/3" />
              <div className="h-3 bg-slate-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {!loading && sortedFindings.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldCheck className="w-12 h-12 text-emerald-500/50" />
          <p className="text-slate-400 text-sm">No AWS security findings{search || severityFilter ? " matching filters" : ""}.</p>
        </div>
      )}

      {!loading && sortedFindings.length > 0 && (
        <div className="space-y-3">
          {sortedFindings.map((finding) => {
            const cfg = SEVERITY_CONFIG[finding.severity];
            const isExpanded = expanded.has(finding.id);
            return (
              <div
                key={finding.id}
                data-nav
                tabIndex={0}
                onClick={() => toggleExpand(finding.id)}
                className={cn("rounded-xl border p-4 cursor-pointer transition-all space-y-2", cfg.border, cfg.bg)}
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert className={cn("w-4 h-4 shrink-0 mt-0.5", cfg.text)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-bold border", cfg.badge)}>
                        {cfg.label}
                      </span>
                      <span className="text-sm font-medium text-slate-200">{finding.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                      <span className="font-mono text-slate-400">{finding.resourceName}</span>
                      <span>·</span>
                      <span>{finding.accountId}</span>
                      {finding.region && <><span>·</span><span>{finding.region}</span></>}
                      <span>·</span>
                      <span className="uppercase tracking-wider">{finding.resourceType.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="pl-7 space-y-3 pt-1">
                    <p className="text-sm text-slate-300 leading-relaxed">{finding.description}</p>
                    {finding.remediationHint && (
                      <div className="rounded-lg bg-slate-800/60 border border-slate-700/40 px-3 py-2">
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Remediation</p>
                        <p className="text-xs text-slate-300">{finding.remediationHint}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
