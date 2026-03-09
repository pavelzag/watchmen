"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CloudTrace, TraceSpan } from "@/lib/gcp/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function latencyColor(ms: number) {
  if (ms < 200) return "text-emerald-400";
  if (ms < 1000) return "text-yellow-400";
  return "text-red-400";
}

function latencyBarColor(ms: number) {
  if (ms < 200) return "bg-emerald-500/60";
  if (ms < 1000) return "bg-yellow-500/60";
  return "bg-red-500/60";
}

function statusColor(code?: number) {
  if (!code) return "text-slate-400";
  if (code < 300) return "text-emerald-400";
  if (code < 500) return "text-yellow-400";
  return "text-red-400";
}

function statusBg(code?: number) {
  if (!code) return "bg-slate-500/10 border-slate-500/20 text-slate-400";
  if (code < 300) return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
  if (code < 500) return "bg-yellow-500/10 border-yellow-500/20 text-yellow-400";
  return "bg-red-500/10 border-red-500/20 text-red-400";
}

function methodColor(m?: string) {
  switch (m) {
    case "GET": return "text-sky-400";
    case "POST": return "text-emerald-400";
    case "PUT": return "text-yellow-400";
    case "PATCH": return "text-orange-400";
    case "DELETE": return "text-red-400";
    default: return "text-slate-400";
  }
}

function formatMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

// ── span tree ────────────────────────────────────────────────────────────────

type SpanNode = TraceSpan & { children: SpanNode[] };

function buildTree(spans: TraceSpan[]): SpanNode[] {
  const map = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];
  for (const s of spans) map.set(s.spanId, { ...s, children: [] });
  for (const node of map.values()) {
    if (node.parentSpanId && map.has(node.parentSpanId)) {
      map.get(node.parentSpanId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function SpanRow({
  node,
  depth,
  traceStart,
  traceDuration,
}: {
  node: SpanNode;
  depth: number;
  traceStart: number;
  traceDuration: number;
}) {
  const spanStart = new Date(node.startTime).getTime();
  const offsetPct = traceDuration > 0 ? ((spanStart - traceStart) / traceDuration) * 100 : 0;
  const widthPct = traceDuration > 0 ? Math.max(0.5, (node.durationMs / traceDuration) * 100) : 1;
  const isError = node.attributes?.["error"] === "true" || (node.httpStatusCode && node.httpStatusCode >= 500);

  return (
    <>
      <div
        className="grid items-center gap-2 py-1.5 border-b border-white/[0.03] text-xs"
        style={{ gridTemplateColumns: "1fr 180px 60px" }}
      >
        {/* name + indent */}
        <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 16 + 8 }}>
          {depth > 0 && (
            <span className="text-white/20 select-none shrink-0">
              {"│  ".repeat(Math.max(0, depth - 1))}{"└─ "}
            </span>
          )}
          <span className={cn("truncate font-mono", isError ? "text-red-400" : "text-slate-300")}>
            {node.displayName}
          </span>
          {isError && <AlertCircle size={10} className="text-red-400 shrink-0" />}
        </div>

        {/* gantt bar */}
        <div className="relative h-4 rounded overflow-hidden bg-white/[0.04]">
          <div
            className={cn("absolute top-0 h-full rounded", isError ? "bg-red-500/50" : latencyBarColor(node.durationMs))}
            style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
          />
        </div>

        {/* duration */}
        <div className={cn("text-right font-mono tabular-nums", isError ? "text-red-400" : latencyColor(node.durationMs))}>
          {formatMs(node.durationMs)}
        </div>
      </div>

      {node.children.map((child) => (
        <SpanRow
          key={child.spanId}
          node={child}
          depth={depth + 1}
          traceStart={traceStart}
          traceDuration={traceDuration}
        />
      ))}
    </>
  );
}

function SpanTree({ trace }: { trace: CloudTrace }) {
  const roots = buildTree(trace.spans);
  const traceStart = new Date(trace.startTime).getTime();

  return (
    <div className="mt-1 mb-3 mx-4 rounded border border-white/[0.06] bg-[#0a0d14] overflow-hidden">
      {/* header row */}
      <div
        className="grid gap-2 px-2 py-1.5 border-b border-white/[0.06] text-[10px] uppercase tracking-widest text-slate-600"
        style={{ gridTemplateColumns: "1fr 180px 60px" }}
      >
        <span>Span</span>
        <span>Timeline</span>
        <span className="text-right">Duration</span>
      </div>
      {roots.map((root) => (
        <SpanRow
          key={root.spanId}
          node={root}
          depth={0}
          traceStart={traceStart}
          traceDuration={trace.durationMs}
        />
      ))}
      {/* attribute pills */}
      {trace.spans.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-t border-white/[0.04]">
          {Array.from(
            new Set(
              trace.spans.flatMap((s) =>
                Object.entries(s.attributes)
                  .filter(([k]) => ["db.type", "peer.service", "messaging.system", "cache.hit"].includes(k))
                  .map(([k, v]) => `${k}: ${v}`)
              )
            )
          ).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 border border-sky-500/20 text-sky-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function LiveTraces() {
  const [traces, setTraces] = useState<CloudTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/traces");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setTraces(data.traces ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load traces");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = [...new Set(traces.map((t) => t.projectId))].sort();

  const filtered = traces.filter((t) => {
    if (projectFilter && t.projectId !== projectFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.displayName.toLowerCase().includes(q) ||
        (t.httpUrl ?? "").toLowerCase().includes(q) ||
        t.projectId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-8 px-2 rounded border border-white/10 bg-white/[0.04] text-slate-300 text-xs focus:outline-none focus:border-sky-500/50"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search path or project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 px-3 rounded border border-white/10 bg-white/[0.04] text-slate-300 text-xs placeholder-slate-600 focus:outline-none focus:border-sky-500/50 w-56"
        />

        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {!loading && (
            <span>
              {filtered.length} trace{filtered.length !== 1 ? "s" : ""} · last 1h
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 h-8 rounded border border-white/10 bg-white/[0.04] text-slate-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={cn(refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* table */}
      <div className="rounded border border-white/[0.06] overflow-hidden">
        {/* table header */}
        <div
          className="grid gap-3 px-4 py-2.5 border-b border-white/[0.06] text-[10px] uppercase tracking-widest text-slate-600 bg-white/[0.02]"
          style={{ gridTemplateColumns: "80px 50px 1fr 160px 90px 80px" }}
        >
          <span>Time</span>
          <span>Method</span>
          <span>Path / Service</span>
          <span>Project</span>
          <span>Status</span>
          <span className="text-right">Latency</span>
        </div>

        {/* loading skeletons */}
        {loading && (
          <div>
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="grid gap-3 px-4 py-3 border-b border-white/[0.03]"
                style={{ gridTemplateColumns: "80px 50px 1fr 160px 90px 80px" }}
              >
                {[...Array(6)].map((_, j) => (
                  <div key={j} className="h-3 rounded bg-white/[0.05] animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* error */}
        {!loading && error && (
          <div className="px-4 py-8 text-center text-sm text-red-400">
            {error}
          </div>
        )}

        {/* rows */}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-slate-600">
            No traces found in the last hour.
          </div>
        )}

        {!loading && !error && filtered.map((trace) => {
          const isExpanded = expandedId === trace.traceId;
          const maxDuration = Math.max(...filtered.map((t) => t.durationMs), 1);
          const barWidth = Math.max(2, (trace.durationMs / maxDuration) * 100);

          return (
            <div key={trace.traceId}>
              {/* main row */}
              <div
                className={cn(
                  "grid gap-3 px-4 py-3 border-b border-white/[0.03] cursor-pointer transition-colors text-xs",
                  "hover:bg-white/[0.03]",
                  isExpanded && "bg-white/[0.04] border-b-transparent"
                )}
                style={{ gridTemplateColumns: "80px 50px 1fr 160px 90px 80px" }}
                onClick={() => setExpandedId(isExpanded ? null : trace.traceId)}
              >
                {/* time */}
                <div className="text-slate-500 font-mono tabular-nums">
                  {formatTime(trace.startTime)}
                </div>

                {/* method */}
                <div className={cn("font-mono font-semibold", methodColor(trace.httpMethod))}>
                  {trace.httpMethod ?? "—"}
                </div>

                {/* path */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {isExpanded
                    ? <ChevronDown size={12} className="text-slate-500 shrink-0" />
                    : <ChevronRight size={12} className="text-slate-600 shrink-0" />
                  }
                  <span className="truncate font-mono text-slate-200">
                    {trace.httpUrl ?? trace.displayName}
                  </span>
                </div>

                {/* project */}
                <div className="truncate text-slate-500 font-mono">{trace.projectId}</div>

                {/* status */}
                <div>
                  <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-mono", statusBg(trace.httpStatusCode))}>
                    {trace.httpStatusCode ?? "—"}
                  </span>
                </div>

                {/* latency */}
                <div className="flex items-center gap-1.5 justify-end">
                  <div className="w-16 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", latencyBarColor(trace.durationMs))}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className={cn("font-mono tabular-nums w-12 text-right", latencyColor(trace.durationMs))}>
                    {formatMs(trace.durationMs)}
                  </span>
                </div>
              </div>

              {/* expanded span tree */}
              {isExpanded && trace.spans.length > 0 && (
                <SpanTree trace={trace} />
              )}
              {isExpanded && trace.spans.length === 0 && (
                <div className="px-8 py-4 text-xs text-slate-600 border-b border-white/[0.03]">
                  No span detail available for this trace.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* legend */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-4 text-[10px] text-slate-600">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500/60" /> &lt;200ms</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-500/60" /> 200ms–1s</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500/60" /> &gt;1s</span>
        </div>
      )}
    </div>
  );
}
