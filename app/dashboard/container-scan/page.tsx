"use client";

import { useEffect, useState } from "react";
import { Container, RefreshCw, AlertTriangle, ChevronRight, Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import type { ImageScanResult, ContainerVulnerability, CveSeverity } from "@/lib/container-scanning";
import { cn } from "@/lib/utils";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";
import { linkifyText } from "@/lib/utils/linkify";

const SEV_STYLES: Record<CveSeverity, { label: string; color: string; border: string; bg: string }> = {
  critical: { label: "CRITICAL", color: "#f87171", border: "#ef4444", bg: "#1a0606" },
  high:     { label: "HIGH",     color: "#fb923c", border: "#f59e0b", bg: "#1a1006" },
  medium:   { label: "MEDIUM",   color: "#fbbf24", border: "#d97706", bg: "#1a1500" },
  low:      { label: "LOW",      color: "#94a3b8", border: "#475569", bg: "#0f1115" },
  negligible:{ label: "INFO",   color: "#6b7280", border: "#374151", bg: "#0f1115" },
};

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

function CveRow({ cve, imageRef, cloud }: { cve: ContainerVulnerability; imageRef: string; cloud: string }) {
  const s = SEV_STYLES[cve.severity];
  const [rec, setRec] = useState<RecState>({ loading: false, text: null, error: null });
  const [open, setOpen] = useState(false);

  async function askAI(forceRegenerate = false) {
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
          imageRef,
          cloud,
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

      {/* AI recommendation area */}
      <div className="mt-2 pl-[42px] pr-4">
        <div className="flex items-center justify-between gap-2 max-w-fit">
          <button
            onClick={rec.text ? () => setOpen((o) => !o) : () => askAI()}
            disabled={rec.loading}
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-medium transition-all duration-150 rounded px-2 py-0.5 font-mono",
              rec.loading
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
            {rec.loading ? "ASKING AI..." : rec.text ? "AI RECOMMENDATION" : "ASK AI"}
          </button>

          {rec.text && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-slate-500 hover:text-slate-300 transition-colors pl-1"
            >
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {rec.error && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400 font-mono">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {rec.error}
          </div>
        )}

        {rec.text && open && (
          <div className="mt-2 bg-[#09090b] border border-slate-800 rounded p-3">
            <div
              className="text-[11px] text-slate-300 leading-relaxed font-sans prose-answer"
              dangerouslySetInnerHTML={{ __html: renderMd(rec.text) }}
            />
            <button
              onClick={() => askAI(true)}
              disabled={rec.loading}
              className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 hover:text-violet-400 transition-colors font-mono"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              REGENERATE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageCard({ result, filter }: { result: ImageScanResult; filter: string }) {
  const [open, setOpen] = useState(filter !== "all");
  const hasCritical = result.summary.critical > 0;
  const hasHigh = result.summary.high > 0;
  const borderColor = hasCritical ? "#ef4444" : hasHigh ? "#f59e0b" : "#374151";

  const filteredVulns = result.vulnerabilities.filter(
    (v) => filter === "all" || v.severity === filter
  );

  const sortedVulns = [...filteredVulns].sort((a, b) => {
    const order: CveSeverity[] = ["critical", "high", "medium", "low", "negligible"];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });

  return (
    <div style={{ border: `1px solid ${borderColor}33`, background: "#09090b", marginBottom: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-4 p-4 transition-colors hover:bg-white/[0.02]"
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
            {result.summary.critical > 0 && (
              <span style={{ fontSize: 9, color: "#f87171", fontFamily: "monospace", border: "1px solid #ef444433", padding: "0 5px" }}>
                {result.summary.critical} CRITICAL
              </span>
            )}
            {result.summary.high > 0 && (
              <span style={{ fontSize: 9, color: "#fb923c", fontFamily: "monospace", border: "1px solid #f59e0b33", padding: "0 5px" }}>
                {result.summary.high} HIGH
              </span>
            )}
            {result.summary.medium > 0 && (
              <span style={{ fontSize: 9, color: "#fbbf24", fontFamily: "monospace", border: "1px solid #d9770633", padding: "0 5px" }}>
                {result.summary.medium} MEDIUM
              </span>
            )}
            {result.summary.low > 0 && (
              <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", border: "1px solid #47556933", padding: "0 5px" }}>
                {result.summary.low} LOW
              </span>
            )}
            <span style={{ fontSize: 9, color: "#4b5563", fontFamily: "monospace" }}>
              · scanned {new Date(result.scannedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
        <ChevronRight
          className="w-4 h-4 shrink-0 mt-1 transition-transform"
          style={{ color: "#4b5563", transform: open ? "rotate(90deg)" : "none" }}
        />
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${borderColor}22`, padding: "0 16px 16px" }}>
          {sortedVulns.length === 0 ? (
            <p style={{ fontSize: 11, color: "#4b5563", fontFamily: "monospace", padding: "12px 0" }}>
              No vulnerabilities found.
            </p>
          ) : (
            <div>
              {sortedVulns.map((cve) => (
                <CveRow key={cve.cveId} cve={cve} imageRef={result.imageRef} cloud={result.cloud} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContainerScanPage() {
  const [results, setResults] = useState<ImageScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/container-scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setResults(data.results);
      setScannedAt(data.scannedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalCritical = results.reduce((s, r) => s + r.summary.critical, 0);
  const totalHigh = results.reduce((s, r) => s + r.summary.high, 0);
  const totalMedium = results.reduce((s, r) => s + r.summary.medium, 0);
  const totalLow = results.reduce((s, r) => s + r.summary.low, 0);
  const totalVulns = results.reduce(
    (s, r) => s + r.summary.critical + r.summary.high + r.summary.medium + r.summary.low + r.summary.negligible,
    0
  );

  const visible = results.filter((r) => {
    if (filter === "all") return true;
    return r.summary[filter] > 0;
  });

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
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
          style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm font-mono" style={{ border: "1px solid var(--red)", color: "var(--red)", background: "#1a0606" }}>
          !! {error}
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Images Scanned", value: results.length, color: "var(--green)" },
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

          {/* Filter */}
          <div className="flex gap-1 flex-wrap">
            {(["all", "critical", "high", "medium", "low"] as const).map((f) => {
              const count = f === "all" ? totalVulns :
                            f === "critical" ? totalCritical :
                            f === "high" ? totalHigh :
                            f === "medium" ? totalMedium :
                            totalLow;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    fontFamily: "monospace", fontSize: 10, letterSpacing: 2, padding: "4px 14px",
                    border: filter === f ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                    color: filter === f ? "var(--green)" : "var(--text-muted)",
                    background: "transparent", textTransform: "uppercase",
                  }}
                >
                  {f} ({count})
                </button>
              );
            })}
          </div>

          {/* Image cards */}
          <div>
            {visible.map((result) => (
              <ImageCard key={result.imageRef} result={result} filter={filter} />
            ))}
          </div>
        </>
      )}

      {!loading && results.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center py-20 gap-4"
          style={{ border: "1px solid var(--border-dim)" }}
        >
          <AlertTriangle className="w-8 h-8" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            No container images found. Connect GCP Artifact Registry, AWS ECR, GHCR, or Docker Hub to enable scanning.
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
    </div>
  );
}
