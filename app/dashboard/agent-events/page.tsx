"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import { cn } from "@/lib/utils";
import { RefreshCw, Loader2, Terminal, X } from "lucide-react";

type HttpEvent = {
  id: number;
  agent_id: string;
  event: {
    type: "http_request" | "http_response";
    timestamp: string;
    hostname: string;
    pid: number;
    uid: number;
    comm: string;
    method?: string;
    path?: string;
    status?: string;
    data: string;
  };
  received_at: string;
};

const METHOD_COLORS: Record<string, string> = {
  GET: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  POST: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  PUT: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  PATCH: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  DELETE: "text-red-400 bg-red-500/10 border-red-500/20",
  HEAD: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  OPTIONS: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

function httpMethodBadge(method: string) {
  const c = METHOD_COLORS[method] ?? "text-slate-400 bg-slate-500/10 border-slate-500/20";
  return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-mono", c)}>{method}</span>;
}

function statusColor(code: string): string {
  const n = parseInt(code, 10);
  if (n >= 200 && n < 300) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (n >= 300 && n < 400) return "text-sky-400 bg-sky-500/10 border-sky-500/20";
  if (n >= 400 && n < 500) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (n >= 500) return "text-red-400 bg-red-500/10 border-red-500/20";
  return "text-slate-400 bg-slate-500/10 border-slate-500/20";
}

function parseCapturedHttp(raw: string | undefined): {
  headers?: Record<string, string>;
  body?: string;
  queryParams?: Record<string, string>;
  contentType?: string;
  traceId?: string;
  traceSource?: string;
  traceMethod?: string;
  payloadBytes?: string;
} {
  if (!raw) return {};
  const normalized = raw.replace(/\r\n/g, "\n");
  const [head, ...bodyParts] = normalized.split(/\n\n/);
  const lines = head.split("\n").filter(Boolean);
  const firstLine = lines[0] ?? "";
  const headers: Record<string, string> = {};

  lines.slice(1).forEach(line => {
    const idx = line.indexOf(":");
    if (idx <= 0) return;
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });

  const path = firstLine.match(/^[A-Z]+\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/)?.[1];
  const queryParams = (() => {
    if (!path) return undefined;
    try {
      const params = [...new URL(path, "http://watchmen.local").searchParams.entries()];
      return params.length > 0 ? Object.fromEntries(params) : undefined;
    } catch {
      return undefined;
    }
  })();
  const getHeader = (name: string) => {
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
  };

  return {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: bodyParts.join("\n\n") || undefined,
    queryParams,
    contentType: getHeader("Content-Type"),
    traceId: getHeader("X-Watchmen-Trace-Id") ?? queryParams?.watchmen_trace_probe,
    traceSource: getHeader("X-Watchmen-Trace-Source"),
    traceMethod: getHeader("X-Watchmen-Trace-Method"),
    payloadBytes: getHeader("X-Watchmen-Payload-Bytes"),
  };
}

function AgentEventModal({ event, onClose }: { event: HttpEvent; onClose: () => void }) {
  const ev = event.event;
  const parsed = parseCapturedHttp(ev.data);
  const isReq = ev.type === "http_request";

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-[min(760px,100%)] max-h-[80vh] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700/70 bg-[#070b07]/96 shadow-2xl shadow-black/60"
        style={{ fontFamily: "var(--font-mono, monospace)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/40 px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Agent Event</div>
            <div className="mt-1 text-[11px] text-emerald-400 font-semibold break-all">
              {isReq ? `${ev.method ?? "HTTP"} ${ev.path ?? "request"}` : `HTTP ${ev.status ?? "response"}`}
            </div>
          </div>
          <button onClick={onClose} className="rounded-sm border border-slate-800 px-2 py-1 text-[9px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300">
            <X size={10} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3 text-[10px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Timestamp</div>
              <div className="mt-1 text-slate-200">{new Date(event.received_at).toLocaleString()}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Node</div>
              <div className="mt-1 text-slate-200 break-all">{ev.hostname}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Process</div>
              <div className="mt-1 text-slate-200 break-all">{ev.comm} · pid {ev.pid} · uid {ev.uid}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Outcome</div>
              <div className="mt-1 text-slate-200">{ev.status ? `HTTP ${ev.status}` : ev.type}</div>
            </div>
          </div>

          {(parsed.traceId || parsed.traceSource || parsed.traceMethod || parsed.contentType || parsed.payloadBytes) && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Trace Probe</div>
              <div className="mt-2 grid gap-1 text-slate-300 sm:grid-cols-2">
                {parsed.traceId ? <div className="break-all"><span className="text-slate-500">Trace ID:</span> {parsed.traceId}</div> : null}
                {parsed.traceSource ? <div><span className="text-slate-500">Source:</span> {parsed.traceSource}</div> : null}
                {parsed.traceMethod ? <div><span className="text-slate-500">Declared method:</span> {parsed.traceMethod}</div> : null}
                {parsed.contentType ? <div className="break-all"><span className="text-slate-500">Content type:</span> {parsed.contentType}</div> : null}
                {parsed.payloadBytes ? <div><span className="text-slate-500">Payload bytes:</span> {parsed.payloadBytes}</div> : null}
              </div>
            </div>
          )}

          {parsed.queryParams && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Query Parameters</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{JSON.stringify(parsed.queryParams, null, 2)}</pre>
            </div>
          )}

          {parsed.headers && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Headers</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{JSON.stringify(parsed.headers, null, 2)}</pre>
            </div>
          )}

          {parsed.body && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Captured Body</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{parsed.body}</pre>
            </div>
          )}

          <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Raw Capture</div>
            <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{ev.data}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentEventsPage() {
  const [events, setEvents] = useState<HttpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [clusters, setClusters] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<HttpEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams({ limit: "100" });
    if (clusterFilter) params.set("cluster", clusterFilter);
    try {
      const res = await fetch(`/api/agents/events/query?${params}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [clusterFilter]);

  useEffect(() => {
    fetch("/api/agents/k8s/status")
      .then((r) => r.json())
      .then((d) => setClusters((d.clusters ?? []).map((c: any) => c.cluster_name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchEvents(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEvents]);

  const filtered = events.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const ev = e.event;
    return (
      ev?.comm?.toLowerCase().includes(q) ||
      ev?.method?.toLowerCase().includes(q) ||
      ev?.path?.toLowerCase().includes(q) ||
      ev?.status?.includes(q) ||
      ev?.hostname?.toLowerCase().includes(q) ||
      String(ev?.pid).includes(q)
    );
  });

  return (
    <div>
      <DetailPageHeader
        title="HTTP Trace Events"
        count={loading ? null : filtered.length}
        search={search}
        onSearch={setSearch}
        projects={clusters}
        projectFilter={clusterFilter}
        onProjectFilter={setClusterFilter}
      />

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => { setLoading(true); fetchEvents(); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/60 transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
          />
          Auto-refresh (5s)
        </label>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading events...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Terminal className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm">
              {search || clusterFilter ? "No events match the current filter." : "No HTTP trace events captured yet."}
            </p>
            <p className="text-xs mt-1 text-slate-600">
              Deploy the Watchmen HTTP trace agent to a GKE cluster to start tracing requests.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/60">
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-20">Time</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-20">Type</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-28">Process</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-16">PID</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-20">Method</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Path / Status</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-44">Node</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const ev = e.event;
                  const isReq = ev.type === "http_request";
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedEvent(e)}
                      className="border-t border-slate-700/30 hover:bg-sky-500/5 transition-colors"
                    >
                      <td className="px-4 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">
                        {e.received_at?.slice(11, 19)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-xs font-mono",
                          isReq
                            ? "text-sky-400 bg-sky-500/10 border-sky-500/20"
                            : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        )}>
                          {isReq ? "REQ" : "RES"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-300 truncate max-w-[120px]">
                        {ev.comm}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{ev.pid}</td>
                      <td className="px-4 py-2">
                        {isReq && ev.method
                          ? httpMethodBadge(ev.method)
                          : ev.status
                          ? <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-mono", statusColor(ev.status))}>{ev.status}</span>
                          : <span className="text-slate-600 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400 truncate max-w-[300px]">
                        {isReq ? (ev.path ?? ev.data) : ev.status ? `HTTP ${ev.status}` : ev.data}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500 truncate max-w-[180px]">
                        {ev.hostname}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selectedEvent && <AgentEventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
