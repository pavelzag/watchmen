"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import { cn } from "@/lib/utils";
import { RefreshCw, Loader2, Terminal } from "lucide-react";

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
    src_ip: string;
    dst_ip: string;
    src_port: number;
    dst_port: number;
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

export default function AgentEventsPage() {
  const [events, setEvents] = useState<HttpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [clusters, setClusters] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

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
      ev?.src_ip?.includes(q) ||
      ev?.dst_ip?.includes(q) ||
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
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400 w-44">Connection</th>
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
                      <td className="px-4 py-2 font-mono text-xs text-slate-400 truncate max-w-[250px]">
                        {isReq ? (ev.path ?? ev.data) : ev.status ? `HTTP ${ev.status}` : ev.data}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500 truncate max-w-[200px]">
                        {ev.src_ip}:{ev.src_port} → {ev.dst_ip}:{ev.dst_port}
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
    </div>
  );
}
