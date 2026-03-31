"use client";

import { useEffect, useState } from "react";
import {
  Globe, Flame, Server, Database, Key, Shield, ChevronRight,
  AlertTriangle, RefreshCw, Lock, User, Cloud, HardDrive,
} from "lucide-react";
import type { AttackPath, AttackNode } from "@/lib/gcp/attack-paths";

// ─── Node icon / colour ───────────────────────────────────────────────────────

function nodeIcon(resourceType: string) {
  const cls = "w-4 h-4 shrink-0";
  switch (resourceType) {
    case "internet":      return <Globe       className={cls} />;
    case "firewall_rule": return <Flame       className={cls} />;
    case "vm":            return <Server      className={cls} />;
    case "cloud_run":     return <Cloud       className={cls} />;
    case "service_account": return <Key      className={cls} />;
    case "storage_bucket": return <HardDrive className={cls} />;
    case "secret":
    case "secrets":       return <Lock        className={cls} />;
    case "project":       return <Shield      className={cls} />;
    case "user":          return <User        className={cls} />;
    case "data":          return <Database    className={cls} />;
    default:              return <Database    className={cls} />;
  }
}

const KIND_STYLES: Record<AttackNode["kind"], { border: string; bg: string; text: string; badge: string }> = {
  entry:  { border: "#ef4444", bg: "#1a0606", text: "#f87171", badge: "ENTRY" },
  pivot:  { border: "#f59e0b", bg: "#1a1206", text: "#fbbf24", badge: "PIVOT" },
  target: { border: "#a855f7", bg: "#12061a", text: "#c084fc", badge: "TARGET" },
};

const SEV_STYLES = {
  critical: { border: "#ef4444", label: "CRITICAL", color: "#ef4444", bg: "#1a0606" },
  high:     { border: "#f59e0b", label: "HIGH",     color: "#f59e0b", bg: "#1a1206" },
};

// ─── Node card ────────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: AttackNode }) {
  const s = KIND_STYLES[node.kind];
  return (
    <div
      style={{
        border: `1px solid ${s.border}44`,
        background: s.bg,
        minWidth: 160,
        maxWidth: 200,
        padding: "10px 12px",
        position: "relative",
      }}
    >
      {/* Kind badge */}
      <div
        style={{
          position: "absolute", top: -9, left: 10,
          fontSize: 8, letterSpacing: 2, fontFamily: "monospace",
          color: s.text, background: s.bg, padding: "0 4px",
          border: `1px solid ${s.border}44`,
        }}
      >
        {s.badge}
      </div>

      <div className="flex items-center gap-2 mb-1" style={{ color: s.text }}>
        {nodeIcon(node.resourceType)}
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", wordBreak: "break-all" }}>
          {node.label.length > 28 ? node.label.slice(0, 26) + "…" : node.label}
        </span>
      </div>

      <p style={{ fontSize: 9, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.4 }}>
        {node.detail.length > 50 ? node.detail.slice(0, 48) + "…" : node.detail}
      </p>

      <p style={{ fontSize: 9, color: s.text, fontFamily: "monospace", marginTop: 4, lineHeight: 1.4, opacity: 0.8 }}>
        ⚠ {node.risk.length > 60 ? node.risk.slice(0, 58) + "…" : node.risk}
      </p>
    </div>
  );
}

// ─── Attack path card ─────────────────────────────────────────────────────────

function PathCard({ path, index }: { path: AttackPath; index: number }) {
  const [open, setOpen] = useState(false);
  const s = SEV_STYLES[path.severity];

  return (
    <div style={{ border: `1px solid ${s.border}33`, background: "#09090b", marginBottom: 12 }}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-4 p-4 transition-colors hover:bg-white/[0.02]"
      >
        <div
          style={{
            fontSize: 9, letterSpacing: 2, fontFamily: "monospace",
            color: s.color, border: `1px solid ${s.border}55`,
            background: s.bg, padding: "2px 8px", whiteSpace: "nowrap", marginTop: 2,
          }}
        >
          {s.label}
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb", fontFamily: "monospace", marginBottom: 4 }}>
            {String(index + 1).padStart(2, "0")}. {path.title}
          </p>
          {/* Mini node chain */}
          <div className="flex items-center gap-1 flex-wrap">
            {path.nodes.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1">
                <span style={{ fontSize: 9, color: KIND_STYLES[n.kind].text, fontFamily: "monospace" }}>
                  {n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label}
                </span>
                {i < path.nodes.length - 1 && (
                  <ChevronRight className="w-3 h-3" style={{ color: "#374151", flexShrink: 0 }} />
                )}
              </span>
            ))}
          </div>
        </div>
        <ChevronRight
          className="w-4 h-4 shrink-0 mt-1 transition-transform"
          style={{ color: "#4b5563", transform: open ? "rotate(90deg)" : "none" }}
        />
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{ borderTop: `1px solid ${s.border}22`, padding: 20 }}>
          {/* Description */}
          <p style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 20 }}>
            {path.description}
          </p>

          {/* Node chain */}
          <div className="flex items-center gap-0 flex-wrap mb-6" style={{ overflowX: "auto", paddingTop: 12 }}>
            {path.nodes.map((node, i) => (
              <div key={node.id} className="flex items-center gap-0">
                <NodeCard node={node} />
                {i < path.nodes.length - 1 && (
                  <div className="flex items-center" style={{ padding: "0 4px" }}>
                    <div style={{ width: 24, height: 1, background: s.border + "66" }} />
                    <ChevronRight className="w-3 h-3" style={{ color: s.border + "99", marginLeft: -6 }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mitigations */}
          <div>
            <p style={{ fontSize: 9, letterSpacing: 3, color: "#4b5563", fontFamily: "monospace", marginBottom: 8 }}>
              // MITIGATIONS
            </p>
            <div className="space-y-2">
              {path.mitigations.map((m, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ fontSize: 10, color: "#00aa2b", fontFamily: "monospace", flexShrink: 0 }}>
                    [{String(i + 1).padStart(2, "0")}]
                  </span>
                  <p style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.6 }}>{m}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttackPathsPage() {
  const [paths, setPaths] = useState<AttackPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "critical" | "high">("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/attack-paths");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setPaths(data.paths);
      setFetchedAt(data.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visible = paths.filter((p) => filter === "all" || p.severity === filter);
  const critCount = paths.filter((p) => p.severity === "critical").length;
  const highCount = paths.filter((p) => p.severity === "high").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase" style={{ color: "var(--green)" }}>
            // Attack Path Analysis
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
            Chains of misconfigurations that combine into exploitable paths
            {fetchedAt && <span style={{ color: "var(--border-dim)" }}> · snapshot {new Date(fetchedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
          style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Analyzing…" : "Re-analyze"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm font-mono" style={{ border: "1px solid var(--red)", color: "var(--red)", background: "#1a0606" }}>
          !! {error}
        </div>
      )}

      {!loading && paths.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Paths", value: paths.length, color: "var(--green)" },
              { label: "Critical", value: critCount, color: "#ef4444" },
              { label: "High", value: highCount, color: "#f59e0b" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)", padding: "12px 16px" }}>
                <p style={{ fontSize: 9, letterSpacing: 3, color: "var(--border-dim)", fontFamily: "monospace" }}>{label.toUpperCase()}</p>
                <p style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.2 }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex gap-1">
            {(["all", "critical", "high"] as const).map((f) => (
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
                {f === "all" ? `ALL (${paths.length})` : f === "critical" ? `CRITICAL (${critCount})` : `HIGH (${highCount})`}
              </button>
            ))}
          </div>

          {/* Paths */}
          <div>
            {visible.map((path, i) => <PathCard key={path.id} path={path} index={i} />)}
          </div>
        </>
      )}

      {!loading && paths.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center py-20 gap-4"
          style={{ border: "1px solid var(--border-dim)" }}
        >
          <AlertTriangle className="w-8 h-8" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            No attack paths found — your configuration looks clean.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ border: "1px solid var(--border-dim)" }}>
          <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            Traversing IAM graph…
          </p>
        </div>
      )}
    </div>
  );
}
