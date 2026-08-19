"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import DetailPageHeader from "@/components/DetailPageHeader";
import { cn } from "@/lib/utils";
import { Check, Loader2, Server, Layers, Box, Network, Terminal, AlertCircle, Trash2 } from "lucide-react";

interface LocalKubernetesStatus {
  ok: boolean;
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
  clusterName: string;
  serverUrl: string;
  kubernetesVersion: string;
  nodeCount: number;
  namespaceCount: number;
  hasKubeconfig?: boolean;
  kubeconfigFilename?: string;
  distribution?: string;
  contexts?: { name: string; cluster: string; user: string }[];
  error?: string;
  code?: string;
}

interface LocalKubernetesResource {
  id: string;
  provider: string;
  kind: string;
  name: string;
  namespace?: string;
  clusterName: string;
  labels: Record<string, string>;
  serviceType?: string;
  clusterIP?: string;
  podIP?: string;
  nodeName?: string;
  phase?: string;
  containers?: string[];
  ports?: { port: number; targetPort: number | string | null; nodePort: number | null }[];
  accessHint?: string;
}

interface ResourcesResponse {
  provider: string;
  cluster: LocalKubernetesStatus;
  resources: LocalKubernetesResource[];
}

export default function SelfManagedPage() {
  const [clusters, setClusters] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<LocalKubernetesStatus | null>(null);
  const [resources, setResources] = useState<ResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const clRes = await fetch("/api/kubernetes/clusters", { cache: "no-store" });
      const clData = await clRes.json();
      const list: Array<{ id: string; name: string }> = Array.isArray(clData.clusters) ? clData.clusters : [];
      setClusters(list);
      if (list.length > 0) {
        const id = selectedId ?? list[0].id;
        if (!selectedId) setSelectedId(id);
        const res = await fetch(`/api/kubernetes/clusters/${id}/status`, { cache: "no-store" });
        const data = await res.json();
        setStatus(data.status ?? null);
        if (data.status?.ok) {
          setResourcesLoading(true);
          try {
            const r2 = await fetch(`/api/kubernetes/clusters/${id}/resources`, { cache: "no-store" });
            const d2 = await r2.json();
            if (r2.ok) setResources(d2);
            else setError(d2.cluster?.error ?? d2.error ?? "Failed to load resources");
          } finally { setResourcesLoading(false); }
        } else if (data.status?.error) {
          setError(data.status.error);
          setResources(null);
        } else {
          setResources(null);
        }
        return;
      }
      // Fallback to legacy single
      const res = await fetch("/api/kubernetes/local/status", { cache: "no-store" });
      const data = await res.json();
      setStatus(data.status ?? null);
      if (data.status?.ok) {
        setResourcesLoading(true);
        try {
          const r2 = await fetch("/api/kubernetes/local/resources", { cache: "no-store" });
          const d2 = await r2.json();
          if (r2.ok) setResources(d2);
          else setError(d2.cluster?.error ?? d2.error ?? "Failed to load resources");
        } finally { setResourcesLoading(false); }
      } else if (data.status?.error) {
        setError(data.status.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [selectedId]);

  async function handleDelete() {
    if (!selectedId) return;
    const target = clusters.find((c) => c.id === selectedId);
    const name = target?.name ?? selectedId;
    if (!confirm(`Delete cluster "${name}"? This will remove its kubeconfig and settings.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/kubernetes/clusters/${selectedId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to delete cluster");
        return;
      }
      const next = clusters.filter((c) => c.id !== selectedId);
      setClusters(next);
      setSelectedId(next.length ? next[0].id : null);
      setStatus(null);
      setResources(null);
      setError(null);
      // reload to refresh status/resources for new selection if any
      if (next.length) {
        // trigger load for next selection
        setTimeout(() => load(), 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const allResources = resources?.resources ?? [];
  const filtered = allResources.filter(r => {
    if (kindFilter !== "all" && r.kind !== kindFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.name.toLowerCase().includes(q) || (r.namespace ?? "").toLowerCase().includes(q) || r.clusterName.toLowerCase().includes(q);
  });

  const kindCounts = allResources.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const distribution = status?.distribution ?? "generic";

  return (
    <div>
      <DetailPageHeader
        title="Self-Managed Kubernetes"
        count={loading ? null : allResources.length}
        search={search}
        onSearch={setSearch}
      />

      {/* Cluster selector when multi */}
      {(clusters.length > 0) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>Cluster:</span>
          {clusters.map((c) => (
            <div key={c.id} className="inline-flex items-center">
              <button
                onClick={() => { setSelectedId(c.id); }}
                className={cn("px-3 py-1.5 text-xs font-mono border", selectedId === c.id ? "bg-emerald-500 text-black border-emerald-500" : "bg-slate-800 text-slate-300")}
                style={selectedId !== c.id ? { borderColor: "var(--border-dim)" } : undefined}
              >
                {c.name}
              </button>
              {clusters.length > 0 && (
                <button
                  onClick={() => {
                    const prev = selectedId;
                    setSelectedId(c.id);
                    setTimeout(() => {
                      // ensure handleDelete sees correct selection; restore if cancelled
                      const ok = confirm(`Delete cluster "${c.name}"? This will remove its kubeconfig and settings.`);
                      if (!ok) { setSelectedId(prev); return; }
                      // call delete directly for this id without relying on selectedId state race
                      (async () => {
                        try {
                          const res = await fetch(`/api/kubernetes/clusters/${c.id}`, { method: "DELETE" });
                          if (!res.ok) {
                            const d = await res.json().catch(() => ({}));
                            setError(d.error ?? "Failed to delete cluster");
                            return;
                          }
                          const next = clusters.filter((x) => x.id !== c.id);
                          setClusters(next);
                          if (selectedId === c.id) {
                            setSelectedId(next.length ? next[0].id : null);
                            setStatus(null);
                            setResources(null);
                          }
                          setError(null);
                          if (next.length) setTimeout(() => load(), 0);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Failed to delete");
                        }
                      })();
                    }, 0);
                  }}
                  title={`Delete ${c.name}`}
                  className="px-1.5 py-1.5 text-xs border-l-0 bg-slate-800 hover:bg-red-900/40 hover:text-red-400 border"
                  style={{ borderColor: "var(--border-dim)", color: "var(--text-muted)" }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <Link href="/dashboard/settings" className="ml-auto text-xs font-mono underline" style={{ color: "var(--text-muted)" }}>Manage clusters →</Link>
        </div>
      )}

      {/* Status banner */}
      <div className="border p-4 mb-4" style={{ borderColor: status?.ok ? "rgba(16,185,129,0.28)" : "var(--border-dim)", background: status?.ok ? "rgba(16,185,129,0.06)" : "rgba(15,23,42,0.45)" }}>
        {loading ? (
          <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking kubeconfig...</div>
        ) : !status?.hasKubeconfig && !status?.ok ? (
          <div className="space-y-2">
            <p className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>No kubeconfig connected</p>
            <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Upload a kubeconfig for k3s, k0s, microk8s, kind, minikube, talos, RKE2 or any self-hosted cluster. Encrypted at rest.</p>
            <div className="flex gap-2">
              <Link href="/dashboard/settings" className="px-3 py-2 text-xs font-bold" style={{ background: "#10b981", color: "#000" }}>UPLOAD KUBECONFIG →</Link>
              <Link href="/dashboard?cloud=self-managed" className="px-3 py-2 text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>DASHBOARD</Link>
            </div>
          </div>
        ) : !status?.ok ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-400" /><span className="text-sm font-bold text-amber-400">{status?.code === "disabled" ? "Disabled" : "Connection error"}</span><span className="px-2 py-0.5 text-[10px] uppercase tracking-widest border bg-slate-800" style={{ borderColor: "var(--border-dim)", color: "var(--text-muted)" }}>{distribution}</span></div>
            <p className="text-xs font-mono text-amber-300/80 break-all">{status?.error ?? error ?? "Enable in Settings and test the connection."}</p>
            <div className="flex gap-2"><Link href="/dashboard/settings" className="px-3 py-2 text-xs font-bold" style={{ background: "#f59e0b", color: "#000" }}>GO TO SETTINGS →</Link><button onClick={load} className="px-3 py-2 text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>RETRY</button></div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "#10b981" }}><Check className="w-4 h-4" />{status.clusterName}</span>
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-widest border bg-emerald-500/10 text-emerald-400" style={{ borderColor: "rgba(16,185,129,0.25)" }}>{distribution}</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{status.kubernetesVersion} · {status.serverUrl}</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>ctx: {status.context} · ns: {status.namespace || "all"}</span>
            </div>
            <div className="flex gap-2 text-xs font-mono">
              <span style={{ color: "var(--text-muted)" }}>{status.nodeCount} nodes</span>
              <span style={{ color: "var(--text-muted)" }}>{status.namespaceCount} namespaces</span>
              <span style={{ color: "#10b981" }}>{allResources.length} resources</span>
            </div>
          </div>
        )}
        {status?.ok && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href="/dashboard/trace" className="px-3 py-1.5 text-xs font-mono inline-flex items-center gap-1" style={{ border: "1px solid #10b981", color: "#10b981" }}><Network className="w-3 h-3" /> LIVE TRACE</Link>
            <Link href="/dashboard/settings" className="px-3 py-1.5 text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>CHANGE KUBECONFIG</Link>
            <button onClick={load} className="px-3 py-1.5 text-xs font-mono inline-flex items-center gap-1" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}><Terminal className="w-3 h-3" /> REFRESH</button>
            <button onClick={handleDelete} disabled={deleting || !selectedId} className="px-3 py-1.5 text-xs font-mono inline-flex items-center gap-1 bg-red-900/20 hover:bg-red-900/40 border border-red-800/50 text-red-400 disabled:opacity-50" title="Delete this connected cluster">
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} DELETE CLUSTER
            </button>
          </div>
        )}
        {/* Delete is also available when connected even if banner not in ok state e.g. single cluster selected - show standalone when we have a selection */}
        {!status?.ok && selectedId && clusters.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={handleDelete} disabled={deleting} className="px-3 py-1.5 text-xs font-mono inline-flex items-center gap-1 bg-red-900/20 hover:bg-red-900/40 border border-red-800/50 text-red-400 disabled:opacity-50">
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} DELETE SELECTED CLUSTER
            </button>
            <span className="text-xs font-mono self-center" style={{ color: "var(--text-muted)" }}>Removes kubeconfig even while connected/disconnected</span>
          </div>
        )}
      </div>

      {/* Kind filter */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {[
          { k: "all", label: "ALL", icon: Layers },
          { k: "cluster", label: "CLUSTER", icon: Server },
          { k: "deployment", label: "DEPLOY", icon: Box },
          { k: "daemonset", label: "DAEMONSET", icon: Layers },
          { k: "statefulset", label: "STATEFUL", icon: Layers },
          { k: "service", label: "SERVICE", icon: Network },
          { k: "pod", label: "PODS", icon: Terminal },
        ].map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={cn("px-2.5 py-1.5 text-xs font-mono inline-flex items-center gap-1 border", kindFilter === k ? "bg-emerald-500 text-black border-emerald-500" : "bg-transparent")}
            style={kindFilter !== k ? { borderColor: "var(--border-dim)", color: "var(--text-muted)" } : undefined}
          >
            <Icon className="w-3 h-3" />{label} {k !== "all" ? `(${(kindCounts[k] ?? 0)})` : `(${allResources.length})`}
          </button>
        ))}
      </div>

      {/* Resources table */}
      <div className="border overflow-hidden" style={{ borderColor: "var(--border-dim)", background: "#050505" }}>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0" style={{ background: "#0a0a0a" }}>
              <tr style={{ borderBottom: "1px solid var(--border-dim)" }}>
                <th className="text-left px-3 py-2" style={{ color: "var(--text-muted)" }}>KIND</th>
                <th className="text-left px-3 py-2" style={{ color: "var(--text-muted)" }}>NAMESPACE / NAME</th>
                <th className="text-left px-3 py-2" style={{ color: "var(--text-muted)" }}>CLUSTER</th>
                <th className="text-left px-3 py-2" style={{ color: "var(--text-muted)" }}>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {resourcesLoading ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>{status?.ok ? "No resources match filter." : "—"}</td></tr>
              ) : (
                filtered.map(r => (
                  <tr key={r.id} className="hover:bg-white/[0.02]" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="px-3 py-2"><span className="px-1.5 py-0.5 border text-[10px] uppercase tracking-widest" style={{ borderColor: "var(--border-dim)", color: "var(--text-muted)" }}>{r.kind}</span></td>
                    <td className="px-3 py-2"><span style={{ color: "var(--text-muted)" }}>{r.namespace ?? "—"}/</span><span style={{ color: "#e5e7eb" }}>{r.name}</span>{r.phase && <span className="ml-2" style={{ color: r.phase === "Running" ? "#10b981" : "var(--text-muted)" }}>({r.phase})</span>}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-muted)" }}>{r.clusterName}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-muted)" }}>
                      {r.kind === "service" ? `${r.serviceType} ${r.clusterIP ?? ""} ${r.ports?.map(p => `${p.port}:${p.targetPort}${p.nodePort ? ` → ${p.nodePort}` : ""}`).join(", ") ?? ""}` : ""}
                      {r.containers?.length ? `containers: ${r.containers.join(", ")}` : ""}
                      {r.podIP ? ` podIP ${r.podIP}` : ""}{r.nodeName ? ` node ${r.nodeName}` : ""}
                      {r.accessHint && <span className="block text-[10px] opacity-60">{r.accessHint}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] font-mono mt-3" style={{ color: "var(--text-muted)" }}>Tip: Use <Link href="/dashboard/trace" style={{ color: "#10b981" }}>Live Trace</Link> to see these services/pods as a topology. For logs, the trace view fetches <span className="font-mono">kubectl logs</span> via the same kubeconfig. Private API? Put it behind VPN/Tailscale or deploy the bridge agent.</p>
    </div>
  );
}
