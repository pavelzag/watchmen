"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Container,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ShieldCheck,
  Search,
  Shield,
  X,
  GitPullRequest,
  Terminal,
} from "lucide-react";
import {
  deduplicateImagesAcrossEnvironments,
  filterLatestPerApplication,
  getApplicationKey,
  getApplicationShortName,
  type ImageScanResult,
  type ContainerVulnerability,
  type CveSeverity,
  type ImageRegistry,
} from "@/lib/container-scanning";
import type { GcpScanWarning } from "@/lib/gcp/types";
import { cn } from "@/lib/utils";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";
import { linkifyText } from "@/lib/utils/linkify";
import CopyAiResponseButton from "@/components/CopyAiResponseButton";
import CopyTextButton from "@/components/CopyTextButton";
import PushToCliModal from "@/components/PushToCliModal";
import TerminalSelect from "@/components/TerminalSelect";
import RemediateModal from "@/app/dashboard/attack-paths/RemediateModal";
import {
  remediationTargetFromContainerCve,
  remediationTargetsFromContainerImage,
  type RemediationTarget,
} from "@/lib/github/remediation-targets";
import {
  handoffIssueFromContainerCve,
  type HandoffIssueItem,
  type HandoffRemediationMode,
} from "@/lib/handoff/tasks";
import { useDemoMode } from "@/components/DemoModeProvider";

const DEMO_AI_DISABLED_MESSAGE =
  "AI queries are disabled in the demo environment. For a preview with AI functionality or real, non-fake data, email zagalsky@gmail.com.";

const SEV_STYLES: Record<CveSeverity, { label: string; color: string; border: string; bg: string }> = {
  critical: { label: "CRITICAL", color: "#f87171", border: "#ef4444", bg: "#1a0606" },
  high:     { label: "HIGH",     color: "#fb923c", border: "#f59e0b", bg: "#1a1006" },
  medium:   { label: "MEDIUM",   color: "#fbbf24", border: "#d97706", bg: "#1a1500" },
  low:      { label: "LOW",      color: "#94a3b8", border: "#475569", bg: "#0f1115" },
  negligible:{ label: "INFO",   color: "#6b7280", border: "#374151", bg: "#0f1115" },
};

const SEVERITY_ORDER: CveSeverity[] = ["critical", "high", "medium", "low", "negligible"];

type SelectableSeverity = "critical" | "high" | "medium" | "low";

function severityMatchesFilter(severity: CveSeverity, selectedSeverities: SelectableSeverity[]): boolean {
  if (selectedSeverities.length === 0) return true;
  return selectedSeverities.includes(severity as SelectableSeverity);
}

function summaryCountForFilter(summary: ImageScanResult["summary"], selectedSeverities: SelectableSeverity[]): number {
  if (selectedSeverities.length === 0) {
    return summary.critical + summary.high + summary.medium + summary.low + summary.negligible;
  }
  return selectedSeverities.reduce((sum, sev) => sum + summary[sev], 0);
}
type CloudFilter = "all" | ImageRegistry;
type StatusFilter = "all" | "vulnerable" | "clean" | "unscanned";
type DateRangeFilter = "all" | "24h" | "7d" | "30d" | "custom";
type SortOption = "critical" | "total_cves" | "newest" | "oldest" | "name_asc";

interface RecState {
  loading: boolean;
  text: string | null;
  error: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMd(text: string): string {
  const html = escapeHtml(text)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre class="bg-slate-900 border border-slate-700/50 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 overflow-x-auto my-2 whitespace-pre-wrap">${code}</pre>`
    )
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-sky-300 text-xs font-mono">$1</code>')
    .replace(/^### (.+)$/gm, '<p class="text-xs font-semibold text-slate-200 uppercase tracking-wider mt-3 mb-1">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="text-sm font-semibold text-slate-200 mt-3 mb-1">$1</p>')
    .replace(/\*\*(.*?)\*\*/g, "<strong class=\"text-slate-200\">$1</strong>")
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class="space-y-1 my-1">${m}</ul>`)
    .replace(/\n(?!<)/g, "<br />");

  return linkifyText(html, []);
}

function formatWarningText(w: GcpScanWarning): {
  warningCommand: string | null;
  fullText: string;
} {
  const callerProjectMatch = w.detail?.match(/in project ([a-z0-9-]+)/i);
  const callerProject =
    callerProjectMatch?.[1] && callerProjectMatch[1] !== w.projectId
      ? callerProjectMatch[1]
      : null;
  const apiCommands =
    w.code === "api_not_enabled"
      ? [
          ...(callerProject && w.requiredApi
            ? [`gcloud services enable ${w.requiredApi} --project=${callerProject}`]
            : []),
          ...(w.enableApiCommand ? [w.enableApiCommand] : []),
        ]
      : [];
  const warningCommand =
    apiCommands.length > 0
      ? apiCommands.join("\n")
      : w.code === "permission_denied" && w.grantCommands && w.grantCommands.length > 0
        ? w.grantCommands.join("\n")
        : null;
  const fullText = [w.message, w.detail, warningCommand].filter(Boolean).join("\n");
  return { warningCommand, fullText };
}

function matchesSearchText(text: string | undefined, needle: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(needle);
}

function cveMatchesFilters(
  cve: ContainerVulnerability,
  selectedSeverities: SelectableSeverity[],
  searchNeedle: string
): boolean {
  if (!severityMatchesFilter(cve.severity, selectedSeverities)) {
    return false;
  }
  if (!searchNeedle) return true;
  return (
    matchesSearchText(cve.cveId, searchNeedle) ||
    matchesSearchText(cve.packageName, searchNeedle) ||
    matchesSearchText(cve.description, searchNeedle) ||
    matchesSearchText(cve.installedVersion, searchNeedle) ||
    matchesSearchText(cve.fixedVersion, searchNeedle)
  );
}

function CveRow({
  cve,
  result,
  onCreatePr,
  onSendToCli,
}: {
  cve: ContainerVulnerability;
  result: ImageScanResult;
  onCreatePr: (targets: RemediationTarget[]) => void;
  onSendToCli: (issues: HandoffIssueItem[]) => void;
}) {
  const s = SEV_STYLES[cve.severity];
  const [rec, setRec] = useState<RecState>({ loading: false, text: null, error: null });
  const [open, setOpen] = useState(false);
  const demoMode = useDemoMode();

  async function askAI(forceRegenerate = false) {
    if (demoMode) {
      setRec({ loading: false, text: null, error: DEMO_AI_DISABLED_MESSAGE });
      setOpen(true);
      return;
    }
    setRec({ loading: true, text: null, error: null });
    setOpen(true);
    try {
      const cacheKey = `watchmen:cve-rec:${cve.cveId}`;

      if (!forceRegenerate) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setRec({ loading: false, text: cached, error: null });
          return;
        }
      }

      const res = await fetch("/api/container-scan/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cve,
          imageRef: result.imageRef,
          cloud: result.cloud,
          demoCredentials: (() => {
            const browserAI = getActiveBrowserAIKey();
            return browserAI ? { aiKey: browserAI.key, aiProvider: browserAI.provider } : undefined;
          })(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");

      localStorage.setItem(cacheKey, data.recommendation);
      setRec({ loading: false, text: data.recommendation, error: null });
    } catch (e) {
      setRec({ loading: false, text: null, error: e instanceof Error ? e.message : "Error" });
    }
  }

  return (
    <div
      className="flex flex-col py-2.5 border-b last:border-0"
      style={{ borderColor: "var(--border-dim)" }}
    >
      <div className="flex items-start gap-3 w-full group">
        <span
          style={{
            fontSize: 8, letterSpacing: 1.5, fontFamily: "monospace",
            color: s.color, border: `1px solid ${s.border}55`, background: s.bg,
            padding: "1px 5px", whiteSpace: "nowrap", marginTop: 2, flexShrink: 0,
          }}
        >
          {s.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span style={{ fontSize: 11, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>
              {cve.cveId}
            </span>
            {cve.cvssScore !== undefined && (
              <span style={{ fontSize: 9, color: "#6b7280", fontFamily: "monospace" }}>
                CVSS {cve.cvssScore.toFixed(1)}
              </span>
            )}
            {cve.shieldStatus && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider border"
                style={
                  cve.shieldStatus.status === "shielded"
                    ? { color: "#c4b5fd", borderColor: "rgba(139,92,246,0.45)", background: "rgba(139,92,246,0.12)" }
                    : cve.shieldStatus.status === "tampered"
                      ? { color: "#fca5a5", borderColor: "rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.12)" }
                      : { color: "#fcd34d", borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.10)" }
                }
                title={`Shirudo ${cve.shieldStatus.upatchId} (${cve.shieldStatus.shieldKind}) · ${cve.shieldStatus.activeNodes} active node(s) · ${cve.shieldStatus.hitCount} blocked hit(s)${cve.shieldStatus.quotePresent ? " · TPM-quoted" : ""}`}
              >
                <Shield className="w-2.5 h-2.5" />
                {cve.shieldStatus.status === "shielded"
                  ? `SHIELDED (${cve.shieldStatus.upatchId}${cve.shieldStatus.hitCount > 0 ? ` · ${cve.shieldStatus.hitCount} hits` : ""})`
                  : cve.shieldStatus.status === "tampered"
                    ? `SHIELD TAMPERED (${cve.shieldStatus.upatchId})`
                    : `SHIELD PENDING (${cve.shieldStatus.upatchId})`}
              </span>
            )}
          </div>
          <p style={{ fontSize: 10, color: "#e5e7eb", fontFamily: "monospace", marginBottom: 2 }}>
            {cve.packageName} {cve.installedVersion}
            {cve.fixedVersion && (
              <span style={{ color: "#4ade80" }}> → fix: {cve.fixedVersion}</span>
            )}
          </p>
          <p style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.4 }}>
            {cve.description}
          </p>
        </div>
      </div>

      {/* Actions: ASK AI, Create PR, Send to CLI */}
      <div className="mt-2 pl-[42px] pr-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={rec.text ? () => setOpen((o) => !o) : () => askAI()}
            disabled={rec.loading || demoMode}
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-medium transition-all duration-150 rounded px-2 py-0.5 font-mono",
              rec.loading || demoMode
                ? "text-slate-500 cursor-not-allowed border border-slate-700/50"
                : rec.text
                  ? "text-violet-400 hover:text-violet-300 border border-violet-500/30 bg-violet-500/10"
                  : "text-slate-500 border border-slate-700/50 hover:text-violet-400 hover:border-violet-500/30"
            )}
          >
            {rec.loading ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Sparkles className="w-2.5 h-2.5" />
            )}
            {rec.loading ? "ASKING AI..." : demoMode ? "DISABLED IN DEMO" : rec.text ? "AI RECOMMENDATION" : "ASK AI"}
          </button>

          {rec.text && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-slate-500 hover:text-slate-300 transition-colors px-0.5"
              aria-label={open ? "Collapse AI recommendation" : "Expand AI recommendation"}
            >
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}

          {!demoMode && (
            <button
              type="button"
              onClick={() =>
                onCreatePr([
                  remediationTargetFromContainerCve({
                    imageRef: result.imageRef,
                    imageName: result.imageName,
                    cloud: result.cloud,
                    accountId: result.accountId,
                    cve,
                  }),
                ])
              }
              className="flex items-center gap-1 text-[10px] font-medium transition-all duration-150 rounded px-2 py-0.5 font-mono border border-violet-500/35 text-violet-300 hover:bg-violet-500/10"
              title="Open a GitHub Pull Request fixing this CVE"
            >
              <GitPullRequest className="w-2.5 h-2.5" />
              Create PR
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              onSendToCli([
                handoffIssueFromContainerCve({
                  imageRef: result.imageRef,
                  imageName: result.imageName,
                  cloud: result.cloud,
                  accountId: result.accountId,
                  cve,
                  aiRecommendation: rec.text ?? undefined,
                }),
              ])
            }
            className="flex items-center gap-1 text-[10px] font-medium transition-all duration-150 rounded px-2 py-0.5 font-mono border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10"
            title="Send this CVE to OpenCode, Claude Code, or Codex"
          >
            <Terminal className="w-2.5 h-2.5" />
            Send to CLI
          </button>
        </div>

        {rec.error && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400 font-mono">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {rec.error}
          </div>
        )}

        {demoMode && !rec.text && !rec.error && (
          <div className="mt-2 text-[10px] font-mono text-slate-500">
            {DEMO_AI_DISABLED_MESSAGE}
          </div>
        )}

        {rec.text && open && (
          <div className="mt-2 bg-[#09090b] border border-slate-800 rounded p-3">
            <div className="mb-2 flex justify-end">
              <CopyAiResponseButton text={rec.text} compact />
            </div>
            <div
              className="text-[11px] text-slate-300 leading-relaxed font-sans prose-answer"
              dangerouslySetInnerHTML={{ __html: renderMd(rec.text) }}
            />
            <button
              type="button"
              onClick={() => askAI(true)}
              disabled={rec.loading || demoMode}
              className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 hover:text-violet-400 transition-colors font-mono"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              {demoMode ? "DISABLED IN DEMO" : "REGENERATE"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageCard({
  result,
  selectedSeverities,
  searchNeedle,
  trivyAvailable,
  scanningRef,
  demoMode,
  onScanImage,
  onCreatePr,
  onSendToCli,
}: {
  result: ImageScanResult;
  selectedSeverities: SelectableSeverity[];
  searchNeedle: string;
  trivyAvailable: boolean;
  scanningRef: boolean;
  demoMode: boolean;
  onScanImage: (imageRef: string, force: boolean) => void;
  onCreatePr: (targets: RemediationTarget[]) => void;
  onSendToCli: (issues: HandoffIssueItem[], defaultMode?: HandoffRemediationMode) => void;
}) {
  const imageLevelMatch =
    !searchNeedle ||
    matchesSearchText(result.imageName, searchNeedle) ||
    matchesSearchText(result.imageRef, searchNeedle) ||
    matchesSearchText(result.accountId, searchNeedle) ||
    Boolean(result.duplicates?.some((d) => matchesSearchText(d.accountId, searchNeedle) || matchesSearchText(d.imageName, searchNeedle) || matchesSearchText(d.imageRef, searchNeedle)));

  const filteredVulns = result.vulnerabilities.filter((v) =>
    cveMatchesFilters(v, selectedSeverities, imageLevelMatch ? "" : searchNeedle)
  );

  const sortedVulns = [...filteredVulns].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  const [open, setOpen] = useState(selectedSeverities.length > 0 || Boolean(searchNeedle && !imageLevelMatch));
  const [cvePage, setCvePage] = useState(1);
  const CVE_PAGE_SIZE = 25;

  useEffect(() => {
    setCvePage(1);
  }, [selectedSeverities, searchNeedle, result.imageRef]);

  useEffect(() => {
    if (selectedSeverities.length > 0 || (searchNeedle && !imageLevelMatch && sortedVulns.length > 0)) {
      setOpen(true);
    }
  }, [selectedSeverities, searchNeedle, imageLevelMatch, sortedVulns.length]);

  const totalCvePages = Math.max(1, Math.ceil(sortedVulns.length / CVE_PAGE_SIZE));
  const safeCvePage = Math.min(cvePage, totalCvePages);
  const cveStart = (safeCvePage - 1) * CVE_PAGE_SIZE;
  const paginatedVulns = sortedVulns.slice(cveStart, cveStart + CVE_PAGE_SIZE);

  const hasCritical = result.summary.critical > 0;
  const hasHigh = result.summary.high > 0;
  const borderColor = hasCritical ? "#ef4444" : hasHigh ? "#f59e0b" : "#374151";
  const canTrivyScan = result.cloud === "gcp" && trivyAvailable;

  return (
    <div style={{ border: `1px solid ${borderColor}33`, background: "#09090b", marginBottom: 10 }}>
      <div className="flex items-start gap-2 p-4 transition-colors hover:bg-white/[0.02] flex-wrap sm:flex-nowrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left flex items-start gap-4 min-w-0"
        >
          <div
            style={{
              flexShrink: 0,
              fontSize: 9,
              color: result.cloud === "gcp" ? "#4ade80" : result.cloud === "aws" ? "#fb923c" : result.cloud === "ghcr" ? "#a78bfa" : "#38bdf8",
              fontFamily: "monospace", border: `1px solid currentColor`,
              padding: "1px 6px", marginTop: 2, opacity: 0.8,
            }}
          >
            {result.cloud.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb", fontFamily: "monospace", marginBottom: 4 }}>
              {result.imageName}
            </p>
            <p style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", marginBottom: 6, wordBreak: "break-all" }}>
              {result.imageRef}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {result.summary.critical > 0 && (selectedSeverities.length === 0 || selectedSeverities.includes("critical")) && (
                <span style={{ fontSize: 9, color: "#f87171", fontFamily: "monospace", border: "1px solid #ef444433", padding: "0 5px" }}>
                  {result.summary.critical} CRITICAL
                </span>
              )}
              {result.summary.high > 0 && (selectedSeverities.length === 0 || selectedSeverities.includes("high")) && (
                <span style={{ fontSize: 9, color: "#fb923c", fontFamily: "monospace", border: "1px solid #f59e0b33", padding: "0 5px" }}>
                  {result.summary.high} HIGH
                </span>
              )}
              {result.summary.medium > 0 && (selectedSeverities.length === 0 || selectedSeverities.includes("medium")) && (
                <span style={{ fontSize: 9, color: "#fbbf24", fontFamily: "monospace", border: "1px solid #d9770633", padding: "0 5px" }}>
                  {result.summary.medium} MEDIUM
                </span>
              )}
              {result.summary.low > 0 && (selectedSeverities.length === 0 || selectedSeverities.includes("low")) && (
                <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", border: "1px solid #47556933", padding: "0 5px" }}>
                  {result.summary.low} LOW
                </span>
              )}
              {result.scanStatus === "clean" && (
                <span style={{ fontSize: 9, color: "#4ade80", fontFamily: "monospace", border: "1px solid #22c55e33", padding: "0 5px" }}>
                  CLEAN
                </span>
              )}
              {result.scanStatus === "unscanned" && (
                <span style={{ fontSize: 9, color: "#fbbf24", fontFamily: "monospace", border: "1px solid #f59e0b33", padding: "0 5px" }}>
                  UNSCANNED
                </span>
              )}
              {result.scanStatus === "failed" && (
                <span style={{ fontSize: 9, color: "#f87171", fontFamily: "monospace", border: "1px solid #ef444433", padding: "0 5px" }}>
                  SCAN FAILED
                </span>
              )}
              {result.duplicates && result.duplicates.length > 1 && (() => {
                const envs = [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))];
                return (
                  <span
                    style={{
                      fontSize: 9,
                      color: "#34d399",
                      fontFamily: "monospace",
                      border: "1px solid rgba(52,211,153,0.4)",
                      background: "rgba(16,185,129,0.08)",
                      padding: "0 5px",
                    }}
                    title={result.duplicates.map((d) => `${d.accountId}: ${d.imageRef}`).join("\n")}
                  >
                    {envs.length > 1 ? `${envs.length} ENVS: ${envs.join(" + ")}` : `${result.duplicates.length} IDENTICAL`}
                  </span>
                );
              })()}
              {result.scanner === "trivy" && (
                <span style={{ fontSize: 9, color: "#38bdf8", fontFamily: "monospace", border: "1px solid #38bdf833", padding: "0 5px" }}>
                  TRIVY
                </span>
              )}
              {(() => {
                const shieldedCount = result.vulnerabilities.filter(
                  (v) => v.shieldStatus?.status === "shielded"
                ).length;
                if (shieldedCount === 0) return null;
                return (
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: 9, color: "#c4b5fd", fontFamily: "monospace", border: "1px solid rgba(139,92,246,0.45)", background: "rgba(139,92,246,0.12)", padding: "0 5px" }}
                  >
                    <Shield className="w-2.5 h-2.5" />
                    {shieldedCount} SHIELDED
                  </span>
                );
              })()}
              <span style={{ fontSize: 9, color: "#4b5563", fontFamily: "monospace" }}>
                · {result.scanStatus === "unscanned" ? "updated" : "scanned"} {new Date(result.scannedAt).toLocaleString()}
              </span>
            </div>
          </div>
          <ChevronRight
            className="w-4 h-4 shrink-0 mt-1 transition-transform"
            style={{ color: "#4b5563", transform: open ? "rotate(90deg)" : "none" }}
          />
        </button>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {sortedVulns.length > 0 && !demoMode && (
            <button
              type="button"
              onClick={() => onCreatePr(remediationTargetsFromContainerImage(result, sortedVulns))}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-violet-500/35 text-violet-300 rounded hover:bg-violet-500/10 transition-colors"
              title="Open a GitHub PR fixing vulnerabilities in this image"
            >
              <GitPullRequest className="w-3 h-3" />
              Create PR
            </button>
          )}
          {sortedVulns.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  const envAccounts = result.duplicates?.length
                    ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
                    : [result.accountId];
                  onSendToCli(
                    sortedVulns.map((cve) =>
                      handoffIssueFromContainerCve({
                        imageRef: result.imageRef,
                        imageName: result.imageName,
                        cloud: result.cloud,
                        accountId: envAccounts.join(", "),
                        cve,
                      })
                    )
                  );
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-emerald-500/35 text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"
                title="Send this image's CVEs to AI / CLI Queue"
              >
                <Terminal className="w-3 h-3" />
                Send to CLI
              </button>
              <button
                type="button"
                onClick={() => {
                  const envAccounts = result.duplicates?.length
                    ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
                    : [result.accountId];
                  onSendToCli(
                    sortedVulns.map((cve) =>
                      handoffIssueFromContainerCve({
                        imageRef: result.imageRef,
                        imageName: result.imageName,
                        cloud: result.cloud,
                        accountId: envAccounts.join(", "),
                        cve,
                      })
                    ),
                    "shirudo_shield"
                  );
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-violet-500/35 text-violet-300 rounded hover:bg-violet-500/10 transition-colors"
                title="Generate a Shirudo live shield (upatch) for this image's CVEs via CLI"
              >
                <Shield className="w-3 h-3" />
                Shield
              </button>
            </>
          )}
          {canTrivyScan && (
            <button
              type="button"
              onClick={() => onScanImage(result.imageRef, result.scanStatus !== "unscanned")}
              disabled={scanningRef}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border rounded shrink-0 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
              style={{
                borderColor: result.scanStatus === "unscanned" ? "#10b98166" : "var(--border-dim)",
                color: result.scanStatus === "unscanned" ? "#4ade80" : "var(--text-muted)",
              }}
            >
              {scanningRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              {scanningRef ? "Scanning…" : result.scanStatus === "unscanned" ? "Scan (Trivy)" : "Re-scan"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${borderColor}22`, padding: "0 16px 16px" }}>
          {sortedVulns.length === 0 ? (
            <div style={{ padding: "12px 0" }} className="space-y-2">
              <p style={{ fontSize: 11, color: result.scanStatus === "unscanned" ? "#fbbf24" : "#94a3b8", fontFamily: "monospace" }}>
                {result.vulnerabilities.length > 0
                  ? "No CVEs match the active search or severity filters."
                  : result.scanStatus === "unscanned" && canTrivyScan
                    ? "No Container Analysis results. Click \"Scan (Trivy)\" to scan this image for CVEs at $0 GCP scanning cost (cached by digest)."
                    : (result.scanStatusMessage ?? "No vulnerabilities found.")}
              </p>
              {result.cloud === "gcp" && result.scanStatus === "unscanned" && result.accountId && !canTrivyScan && (
                <div className="flex items-center justify-between gap-2 bg-slate-900/80 border border-slate-800 rounded px-3 py-2">
                  <pre className="text-[10px] font-mono text-slate-300 overflow-x-auto select-text">
                    {`gcloud services enable containerscanning.googleapis.com --project=${result.accountId}`}
                  </pre>
                  <CopyTextButton
                    text={`gcloud services enable containerscanning.googleapis.com --project=${result.accountId}`}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-slate-700 rounded text-slate-300 hover:text-white shrink-0"
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              {paginatedVulns.map((cve, idx) => (
                <CveRow
                  key={`${cve.cveId}-${cve.packageName}-${cve.installedVersion}-${cveStart + idx}`}
                  cve={cve}
                  result={result}
                  onCreatePr={onCreatePr}
                  onSendToCli={onSendToCli}
                />
              ))}
              {sortedVulns.length > CVE_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2 pt-3 mt-1 border-t border-slate-800/70 text-[11px] font-mono text-slate-400">
                  <span>
                    Showing {cveStart + 1}–{Math.min(cveStart + CVE_PAGE_SIZE, sortedVulns.length)} of {sortedVulns.length} CVEs
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCvePage((p) => Math.max(1, p - 1))}
                      disabled={safeCvePage <= 1}
                      className="flex items-center gap-1 px-2 py-0.5 border border-slate-800 text-slate-300 hover:bg-white/5 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-3 h-3" />
                      Prev
                    </button>
                    <span className="px-1.5 text-slate-500">
                      {safeCvePage} / {totalCvePages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCvePage((p) => Math.min(totalCvePages, p + 1))}
                      disabled={safeCvePage >= totalCvePages}
                      className="flex items-center gap-1 px-2 py-0.5 border border-slate-800 text-slate-300 hover:bg-white/5 disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContainerScanPage() {
  const demoMode = useDemoMode();
  const [results, setResults] = useState<ImageScanResult[]>([]);
  const [warnings, setWarnings] = useState<GcpScanWarning[]>([]);
  const [gcpProjects, setGcpProjects] = useState<string[]>([]);
  const [gcpAuthConfigured, setGcpAuthConfigured] = useState(true);
  const [trivyAvailable, setTrivyAvailable] = useState(false);
  const [scanningRefs, setScanningRefs] = useState<Record<string, boolean>>({});
  const [scanningAll, setScanningAll] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  // Filters, sorting, pagination
  const [search, setSearch] = useState("");
  const [selectedSeverities, setSelectedSeverities] = useState<SelectableSeverity[]>([]);
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [appFilter, setAppFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [latestOnly, setLatestOnly] = useState(false);
  const [dedupEnvs, setDedupEnvs] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("critical");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // PR & CLI handoff modals
  const [remediateTargets, setRemediateTargets] = useState<RemediationTarget[] | null>(null);
  const [cliModalState, setCliModalState] = useState<{
    issues: HandoffIssueItem[];
    defaultRemediationMode?: HandoffRemediationMode;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/container-scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setResults(data.results ?? []);
      setWarnings(data.warnings ?? []);
      setGcpProjects(data.gcpProjects ?? []);
      setGcpAuthConfigured(data.gcpAuthConfigured ?? true);
      setTrivyAvailable(Boolean(data.trivyAvailable));
      setScannedAt(data.scannedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runTrivyScan(imageRefs: string[], force = false) {
    if (imageRefs.length === 0) return;
    setScanError(null);
    setScanningRefs((prev) => {
      const next = { ...prev };
      for (const ref of imageRefs) next[ref] = true;
      return next;
    });

    try {
      const res = await fetch("/api/container-scan/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageRefs, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Trivy scan failed");
      }

      const scannedList = (data.scanned ?? []) as ImageScanResult[];
      const errorsList = (data.errors ?? []) as Array<{ imageRef: string; error: string }>;

      if (scannedList.length > 0) {
        const scannedByRef = new Map(scannedList.map((s) => [s.imageRef, s]));
        setResults((prev) => prev.map((item) => scannedByRef.get(item.imageRef) ?? item));
      }

      if (errorsList.length > 0) {
        setScanError(errorsList.map((e) => `${e.imageRef}: ${e.error}`).join("; "));
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Trivy scan failed");
    } finally {
      setScanningRefs((prev) => {
        const next = { ...prev };
        for (const ref of imageRefs) delete next[ref];
        return next;
      });
    }
  }

  async function scanAllUnscanned() {
    const refs = scopedResults
      .filter((r) => r.cloud === "gcp" && r.scanStatus === "unscanned")
      .map((r) => r.imageRef);
    if (refs.length === 0) return;
    setScanningAll(true);
    try {
      await runTrivyScan(refs, false);
    } finally {
      setScanningAll(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setPage(1);
  }, [search, selectedSeverities, cloudFilter, appFilter, statusFilter, latestOnly, dedupEnvs, dateRange, dateFrom, dateTo, sortBy, pageSize]);

  // When Trivy is active, managed Container Analysis 403/disabled is optional non-blocking noise.
  const actionableWarnings = useMemo(() => {
    return warnings.filter(
      (w) =>
        !(
          w.service === "containeranalysis" &&
          trivyAvailable &&
          (w.code === "permission_denied" || w.code === "api_not_enabled")
        )
    );
  }, [warnings, trivyAvailable]);

  const latestResults = useMemo(() => filterLatestPerApplication(results), [results]);
  const baseScopedResults = latestOnly ? latestResults : results;
  const dedupedResults = useMemo(
    () => deduplicateImagesAcrossEnvironments(baseScopedResults),
    [baseScopedResults]
  );
  const duplicateCount = Math.max(0, baseScopedResults.length - dedupedResults.length);
  const scopedResults = dedupEnvs ? dedupedResults : baseScopedResults;

  const appPool = useMemo(
    () => (cloudFilter === "all" ? scopedResults : scopedResults.filter((r) => r.cloud === cloudFilter)),
    [scopedResults, cloudFilter]
  );

  const appOptions = useMemo(() => {
    const byKey = new Map<
      string,
      { key: string; shortName: string; accountId: string; cloud: ImageRegistry; count: number }
    >();
    for (const r of appPool) {
      const key = getApplicationKey(r);
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, {
          key,
          shortName: getApplicationShortName(r),
          accountId: r.accountId,
          cloud: r.cloud,
          count: 1,
        });
      }
    }

    const nameCounts = new Map<string, number>();
    for (const entry of byKey.values()) {
      nameCounts.set(entry.shortName, (nameCounts.get(entry.shortName) ?? 0) + 1);
    }

    return Array.from(byKey.values())
      .map((entry) => {
        const hasDuplicateName = (nameCounts.get(entry.shortName) ?? 0) > 1;
        const scopeLabel = entry.accountId || entry.cloud.toUpperCase();
        const baseLabel = hasDuplicateName ? `${entry.shortName} (${scopeLabel})` : entry.shortName;
        return {
          value: entry.key,
          label: `${baseLabel} (${entry.count})`,
          sortKey: baseLabel.toLowerCase(),
        };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ value, label }) => ({ value, label }));
  }, [appPool]);

  useEffect(() => {
    if (appFilter !== "all" && !appOptions.some((opt) => opt.value === appFilter)) {
      setAppFilter("all");
    }
  }, [appFilter, appOptions]);

  const searchNeedle = search.trim().toLowerCase();

  const nonSeverityFiltered = useMemo(() => {
    const now = Date.now();
    const minTs =
      dateRange === "24h"
        ? now - 24 * 3600_000
        : dateRange === "7d"
          ? now - 7 * 86400_000
          : dateRange === "30d"
            ? now - 30 * 86400_000
            : dateRange === "custom" && dateFrom
              ? new Date(`${dateFrom}T00:00:00`).getTime()
              : null;
    const maxTs =
      dateRange === "custom" && dateTo
        ? new Date(`${dateTo}T23:59:59.999`).getTime()
        : null;

    return scopedResults.filter((r) => {
      if (cloudFilter !== "all" && r.cloud !== cloudFilter) return false;
      if (appFilter !== "all" && getApplicationKey(r) !== appFilter) return false;

      if (statusFilter === "vulnerable" && r.vulnerabilities.length === 0) return false;
      if (statusFilter === "clean" && !(r.scanStatus === "clean" || (r.scanStatus !== "unscanned" && r.vulnerabilities.length === 0))) {
        return false;
      }
      if (statusFilter === "unscanned" && r.scanStatus !== "unscanned") return false;

      if (minTs !== null || maxTs !== null) {
        const ts = new Date(r.imageUpdatedAt ?? r.scannedAt).getTime();
        if (Number.isFinite(ts)) {
          if (minTs !== null && ts < minTs) return false;
          if (maxTs !== null && ts > maxTs) return false;
        }
      }

      return true;
    });
  }, [scopedResults, cloudFilter, appFilter, statusFilter, dateRange, dateFrom, dateTo]);

  const filteredAndSorted = useMemo(() => {
    const filtered = nonSeverityFiltered.filter((r) => {
      if (selectedSeverities.length > 0 && summaryCountForFilter(r.summary, selectedSeverities) === 0) return false;

      if (searchNeedle) {
        const imageMatch =
          matchesSearchText(r.imageName, searchNeedle) ||
          matchesSearchText(r.imageRef, searchNeedle) ||
          matchesSearchText(r.accountId, searchNeedle) ||
          Boolean(r.duplicates?.some((d) => matchesSearchText(d.accountId, searchNeedle) || matchesSearchText(d.imageName, searchNeedle) || matchesSearchText(d.imageRef, searchNeedle)));
        const cveMatch = r.vulnerabilities.some((v) =>
          cveMatchesFilters(v, selectedSeverities, searchNeedle)
        );
        if (!imageMatch && !cveMatch) return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.imageUpdatedAt ?? b.scannedAt).getTime() - new Date(a.imageUpdatedAt ?? a.scannedAt).getTime();
      }
      if (sortBy === "oldest") {
        return new Date(a.imageUpdatedAt ?? a.scannedAt).getTime() - new Date(b.imageUpdatedAt ?? b.scannedAt).getTime();
      }
      if (sortBy === "name_asc") {
        return a.imageName.localeCompare(b.imageName);
      }
      if (sortBy === "total_cves") {
        return b.vulnerabilities.length - a.vulnerabilities.length;
      }
      // "critical" default
      if (b.summary.critical !== a.summary.critical) return b.summary.critical - a.summary.critical;
      if (b.summary.high !== a.summary.high) return b.summary.high - a.summary.high;
      if (b.summary.medium !== a.summary.medium) return b.summary.medium - a.summary.medium;
      if (b.summary.low !== a.summary.low) return b.summary.low - a.summary.low;
      return b.vulnerabilities.length - a.vulnerabilities.length;
    });
  }, [nonSeverityFiltered, selectedSeverities, searchNeedle, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const paginated = filteredAndSorted.slice(pageStart, pageStart + pageSize);

  // Totals across active non-severity scope (registry, app, status, date, latest-only)
  const totalCritical = nonSeverityFiltered.reduce((s, r) => s + r.summary.critical, 0);
  const totalHigh = nonSeverityFiltered.reduce((s, r) => s + r.summary.high, 0);
  const totalMedium = nonSeverityFiltered.reduce((s, r) => s + r.summary.medium, 0);
  const totalLow = nonSeverityFiltered.reduce((s, r) => s + r.summary.low, 0);
  const totalVulns = nonSeverityFiltered.reduce(
    (s, r) => s + r.summary.critical + r.summary.high + r.summary.medium + r.summary.low + r.summary.negligible,
    0
  );

  // Matching CVEs across filtered images (for header Create PR & Send to CLI buttons)
  const visibleCvePairs = useMemo(() => {
    const pairs: Array<{ result: ImageScanResult; cve: ContainerVulnerability }> = [];
    for (const r of filteredAndSorted) {
      const imageMatch =
        !searchNeedle ||
        matchesSearchText(r.imageName, searchNeedle) ||
        matchesSearchText(r.imageRef, searchNeedle) ||
        matchesSearchText(r.accountId, searchNeedle) ||
        Boolean(r.duplicates?.some((d) => matchesSearchText(d.accountId, searchNeedle) || matchesSearchText(d.imageName, searchNeedle) || matchesSearchText(d.imageRef, searchNeedle)));
      for (const cve of r.vulnerabilities) {
        if (cveMatchesFilters(cve, selectedSeverities, imageMatch ? "" : searchNeedle)) {
          pairs.push({ result: r, cve });
        }
      }
    }
    return pairs;
  }, [filteredAndSorted, selectedSeverities, searchNeedle]);

  const unscannedGcpCount = scopedResults.filter(
    (r) => r.cloud === "gcp" && r.scanStatus === "unscanned"
  ).length;

  const hasActiveFilters =
    Boolean(search) ||
    selectedSeverities.length > 0 ||
    cloudFilter !== "all" ||
    appFilter !== "all" ||
    statusFilter !== "all" ||
    latestOnly ||
    dedupEnvs ||
    dateRange !== "all";

  function clearFilters() {
    setSearch("");
    setSelectedSeverities([]);
    setCloudFilter("all");
    setAppFilter("all");
    setStatusFilter("all");
    setLatestOnly(false);
    setDedupEnvs(false);
    setDateRange("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("critical");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2" style={{ color: "var(--green)" }}>
            <Container className="w-4 h-4" />
            // Container Image Scanning
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
            CVE scan results from GCP, AWS ECR, GitHub Container Registry, and Docker Hub.
            {scannedAt && (
              <span style={{ color: "var(--border-dim)" }}> · snapshot {new Date(scannedAt).toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {visibleCvePairs.length > 0 && !demoMode && (
            <button
              type="button"
              onClick={() =>
                setRemediateTargets(
                  visibleCvePairs.slice(0, 40).map(({ result, cve }) => {
                    const envAccounts = result.duplicates?.length
                      ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
                      : [result.accountId];
                    return remediationTargetFromContainerCve({
                      imageRef: result.imageRef,
                      imageName: result.imageName,
                      cloud: result.cloud,
                      accountId: result.accountId,
                      projectIds: envAccounts,
                      cve,
                    });
                  })
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 transition-all"
              title="Open a GitHub PR fixing visible container CVEs"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              Create PR
            </button>
          )}
          {visibleCvePairs.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setCliModalState({
                    issues: visibleCvePairs.map(({ result, cve }) => {
                      const envAccounts = result.duplicates?.length
                        ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
                        : [result.accountId];
                      return handoffIssueFromContainerCve({
                        imageRef: result.imageRef,
                        imageName: result.imageName,
                        cloud: result.cloud,
                        accountId: envAccounts.join(", "),
                        cve,
                      });
                    }),
                    defaultRemediationMode: "iac",
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-all"
                title="Send visible CVEs to OpenCode, Claude Code, or Codex"
              >
                <Terminal className="w-3.5 h-3.5" />
                Send to CLI
              </button>
              <button
                type="button"
                onClick={() =>
                  setCliModalState({
                    issues: visibleCvePairs.map(({ result, cve }) => {
                      const envAccounts = result.duplicates?.length
                        ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
                        : [result.accountId];
                      return handoffIssueFromContainerCve({
                        imageRef: result.imageRef,
                        imageName: result.imageName,
                        cloud: result.cloud,
                        accountId: envAccounts.join(", "),
                        cve,
                      });
                    }),
                    defaultRemediationMode: "shirudo_shield",
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 transition-all"
                title="Generate Shirudo live shields (upatch) for visible CVEs via CLI"
              >
                <Shield className="w-3.5 h-3.5" />
                Shield (Shirudo)
              </button>
            </>
          )}
          {trivyAvailable && unscannedGcpCount > 0 && (
            <button
              type="button"
              onClick={scanAllUnscanned}
              disabled={loading || scanningAll}
              className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all disabled:opacity-50"
              style={{ border: "1px solid #10b98166", color: "#4ade80", background: "#052e1640" }}
            >
              {scanningAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              {scanningAll ? `Scanning ${unscannedGcpCount}…` : `Scan Unscanned (${unscannedGcpCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
            style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {(error || scanError) && (
        <div className="px-4 py-3 text-sm font-mono" style={{ border: "1px solid var(--red)", color: "var(--red)", background: "#1a0606" }}>
          !! {error ?? scanError}
        </div>
      )}

      {!loading && actionableWarnings.length > 0 && (
        <div
          className="px-4 py-3 space-y-2.5 text-xs font-mono select-text"
          style={{ border: "1px solid #f59e0b55", background: "#1a1006", color: "#fbbf24" }}
        >
          <div className="flex items-center justify-between gap-2 font-bold uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>GCP Container Scan Diagnostics ({actionableWarnings.length})</span>
            </div>
            <CopyTextButton
              text={actionableWarnings.map((w) => formatWarningText(w).fullText).join("\n\n")}
              label="Copy all"
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-normal normal-case tracking-normal border border-amber-500/30 rounded text-amber-200 hover:bg-amber-500/10 transition-colors shrink-0"
            />
          </div>
          <div className="space-y-2">
            {actionableWarnings.map((w, idx) => {
              const { warningCommand, fullText } = formatWarningText(w);
              return (
                <div key={`${w.service}-${w.projectId}-${idx}`} className="border-t border-amber-500/20 pt-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-amber-200">{w.message}</div>
                    <CopyTextButton
                      text={fullText}
                      label="Copy"
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-amber-500/30 rounded text-amber-200 hover:bg-amber-500/10 transition-colors shrink-0"
                    />
                  </div>
                  {w.detail && <div className="text-[10px] text-amber-300/70 break-all">{w.detail}</div>}
                  {warningCommand && (
                    <div className="flex items-center justify-between gap-2 bg-black/40 border border-amber-500/20 rounded px-2.5 py-1.5">
                      <pre className="text-[10px] text-slate-200 overflow-x-auto select-text">
                        {warningCommand}
                      </pre>
                      <CopyTextButton
                        text={warningCommand}
                        label="Copy cmd"
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-amber-500/30 rounded text-amber-200 hover:bg-amber-500/10 transition-colors shrink-0"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: latestOnly ? "Latest Apps" : "Images Listed", value: scopedResults.length, color: "var(--green)" },
              { label: "Total CVEs", value: totalVulns, color: "var(--text-muted)" },
              { label: "Critical", value: totalCritical, color: "#f87171" },
              { label: "High", value: totalHigh, color: "#fb923c" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)", padding: "12px 16px" }}>
                <p style={{ fontSize: 9, letterSpacing: 3, color: "var(--border-dim)", fontFamily: "monospace" }}>{label.toUpperCase()}</p>
                <p style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.2 }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Search, Filter & Sort Controls */}
          <div className="space-y-3 p-3 border" style={{ borderColor: "var(--border-dim)", background: "#09090b" }}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by image name, project, CVE ID, or package…"
                  aria-label="Filter container scans"
                  className="w-full pl-8 pr-8 py-1.5 bg-black/50 border border-slate-800 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <TerminalSelect
                value={cloudFilter}
                onChange={setCloudFilter}
                ariaLabel="Filter by registry"
                prefix="REG:"
                active={cloudFilter !== "all"}
                options={[
                  { value: "all", label: "All registries" },
                  { value: "gcp", label: "GCP Artifact Registry" },
                  { value: "aws", label: "AWS ECR" },
                  { value: "ghcr", label: "GitHub (GHCR)" },
                  { value: "dockerhub", label: "Docker Hub" },
                ]}
              />

              <TerminalSelect
                value={appFilter}
                onChange={setAppFilter}
                ariaLabel="Filter by image app"
                prefix="APP:"
                active={appFilter !== "all"}
                options={[
                  { value: "all", label: `All apps (${appOptions.length})` },
                  ...appOptions,
                ]}
              />

              <TerminalSelect
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel="Filter by scan status"
                prefix="STATUS:"
                active={statusFilter !== "all"}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "vulnerable", label: "Has CVEs" },
                  { value: "clean", label: "Clean (0 CVEs)" },
                  { value: "unscanned", label: "Unscanned" },
                ]}
              />

              <TerminalSelect
                value={dateRange}
                onChange={setDateRange}
                ariaLabel="Filter by date"
                prefix="DATE:"
                active={dateRange !== "all"}
                options={[
                  { value: "all", label: "Any time" },
                  { value: "24h", label: "Last 24 hours" },
                  { value: "7d", label: "Last 7 days" },
                  { value: "30d", label: "Last 30 days" },
                  { value: "custom", label: "Custom range…" },
                ]}
              />

              <TerminalSelect
                value={sortBy}
                onChange={setSortBy}
                ariaLabel="Sort images"
                prefix="SORT:"
                active={sortBy !== "critical"}
                options={[
                  { value: "critical", label: "Highest severity" },
                  { value: "total_cves", label: "Most CVEs" },
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                  { value: "name_asc", label: "Name (A–Z)" },
                ]}
              />

              <button
                type="button"
                onClick={() => setLatestOnly((v) => !v)}
                aria-pressed={latestOnly}
                title="Show only the most recent image version per application"
                className="px-2.5 py-1.5 text-xs font-mono transition-colors whitespace-nowrap"
                style={{
                  border: latestOnly ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                  color: latestOnly ? "var(--green)" : "var(--text-muted)",
                  background: latestOnly ? "rgba(0, 255, 65, 0.08)" : "#09090b",
                }}
              >
                Latest per app ({latestResults.length})
              </button>

              <button
                type="button"
                onClick={() => setDedupEnvs((v) => !v)}
                aria-pressed={dedupEnvs}
                title="Deduplicate identical images across environments (e.g. prod and dev)"
                className="px-2.5 py-1.5 text-xs font-mono transition-colors whitespace-nowrap"
                style={{
                  border: dedupEnvs ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                  color: dedupEnvs ? "var(--green)" : "var(--text-muted)",
                  background: dedupEnvs ? "rgba(0, 255, 65, 0.08)" : "#09090b",
                }}
              >
                Dedup envs ({duplicateCount})
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-2.5 py-1.5 text-[11px] font-mono border border-slate-700 text-slate-400 hover:text-slate-200"
                >
                  Reset
                </button>
              )}
            </div>

            {dateRange === "custom" && (
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                <span>From:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Date from"
                  className="px-2 py-1 bg-black/50 border border-slate-800 text-xs font-mono text-slate-200"
                />
                <span>To:</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Date to"
                  className="px-2 py-1 bg-black/50 border border-slate-800 text-xs font-mono text-slate-200"
                />
              </div>
            )}

            {/* Severity Pills */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedSeverities([])}
                  aria-pressed={selectedSeverities.length === 0}
                  style={{
                    fontFamily: "monospace", fontSize: 10, letterSpacing: 1.5, padding: "4px 12px",
                    border: selectedSeverities.length === 0 ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                    color: selectedSeverities.length === 0 ? "var(--green)" : "var(--text-muted)",
                    background: "transparent", textTransform: "uppercase",
                  }}
                >
                  All ({totalVulns})
                </button>
                {([
                  { id: "critical", label: "Critical", count: totalCritical },
                  { id: "high", label: "High", count: totalHigh },
                  { id: "medium", label: "Medium", count: totalMedium },
                  { id: "low", label: "Low", count: totalLow },
                ] as const).map((item) => {
                  const active = selectedSeverities.includes(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() =>
                        setSelectedSeverities((prev) =>
                          prev.includes(item.id)
                            ? prev.filter((sev) => sev !== item.id)
                            : [...prev, item.id]
                        )
                      }
                      aria-pressed={active}
                      style={{
                        fontFamily: "monospace", fontSize: 10, letterSpacing: 1.5, padding: "4px 12px",
                        border: active ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                        color: active ? "var(--green)" : "var(--text-muted)",
                        background: "transparent", textTransform: "uppercase",
                      }}
                    >
                      {item.label} ({item.count})
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {filteredAndSorted.length} image{filteredAndSorted.length === 1 ? "" : "s"} · {visibleCvePairs.length} matching CVE{visibleCvePairs.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {/* Image cards */}
          {paginated.length === 0 ? (
            <div className="py-12 text-center border font-mono text-xs text-slate-500" style={{ borderColor: "var(--border-dim)" }}>
              No container images or CVEs match the selected filters.
            </div>
          ) : (
            <div>
              {paginated.map((result) => (
                <ImageCard
                  key={result.imageRef}
                  result={result}
                  selectedSeverities={selectedSeverities}
                  searchNeedle={searchNeedle}
                  trivyAvailable={trivyAvailable}
                  scanningRef={Boolean(scanningRefs[result.imageRef])}
                  demoMode={demoMode}
                  onScanImage={(ref, force) => void runTrivyScan([ref], force)}
                  onCreatePr={(targets) => setRemediateTargets(targets)}
                  onSendToCli={(issues, defaultRemediationMode = "iac") =>
                    setCliModalState({ issues, defaultRemediationMode })
                  }
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {filteredAndSorted.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t text-xs font-mono text-slate-400"
              style={{ borderColor: "var(--border-dim)" }}
            >
              <div className="flex items-center gap-2">
                <span>
                  Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filteredAndSorted.length)} of {filteredAndSorted.length}
                </span>
                <TerminalSelect
                  value={String(pageSize)}
                  onChange={(val) => setPageSize(Number(val))}
                  ariaLabel="Items per page"
                  options={[
                    { value: "10", label: "10 / page" },
                    { value: "25", label: "25 / page" },
                    { value: "50", label: "50 / page" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="flex items-center gap-1 px-2.5 py-1 border border-slate-800 text-slate-300 hover:bg-white/5 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Prev
                </button>
                <span className="px-2 text-slate-500">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="flex items-center gap-1 px-2.5 py-1 border border-slate-800 text-slate-300 hover:bg-white/5 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && results.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center py-20 gap-4 px-6 text-center"
          style={{ border: "1px solid var(--border-dim)" }}
        >
          <AlertTriangle className="w-8 h-8" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            {actionableWarnings.length > 0
              ? "No container images returned — review the GCP scan diagnostics above to enable APIs or grant permissions."
              : !gcpAuthConfigured
                ? "No GCP credentials configured. Connect GCP in Settings, or connect AWS ECR, GHCR, or Docker Hub to enable scanning."
                : gcpProjects.length === 0
                  ? "No GCP projects configured to scan (set GCP_PROJECTS or GCP_ORG_ID, or run a GCP scan first), and no images were found in AWS ECR, GHCR, or Docker Hub."
                  : `No container images found in Artifact Registry (${gcpProjects.join(", ")}), AWS ECR, GHCR, or Docker Hub.`}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ border: "1px solid var(--border-dim)" }}>
          <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            Fetching CVE scan results…
          </p>
        </div>
      )}

      {remediateTargets && (
        <RemediateModal
          targets={remediateTargets}
          onClose={() => setRemediateTargets(null)}
        />
      )}

      <PushToCliModal
        isOpen={Boolean(cliModalState)}
        onClose={() => setCliModalState(null)}
        issues={cliModalState?.issues ?? []}
        contextLabel="Container CVEs"
        defaultRemediationMode={cliModalState?.defaultRemediationMode ?? "iac"}
      />
    </div>
  );
}
