"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Download, ExternalLink } from "lucide-react";
import type { GkeCluster } from "@/lib/gcp/types";
import EntryPointsPanel from "./EntryPointsPanel";

type SortDir = "asc" | "desc";

type ClusterAgentStatus = {
  clusterName: string;
  nodeCount: number;
  healthyCount: number;
};

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  PROVISIONING: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  STOPPING: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  ERROR: "text-red-400 bg-red-500/10 border-red-500/20",
};

const AGENT_COLORS: Record<string, string> = {
  deployed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  none: "border-slate-700 bg-slate-800/60 text-slate-400",
};

function SortHeader({ label, active, dir, onSort }: { label: string; active: boolean; dir: SortDir; onSort: () => void }) {
  return (
    <th className="px-4 py-3 text-left cursor-pointer select-none group" onClick={onSort}>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400 group-hover:text-slate-200 transition-colors">
        {label}
        <span className="w-3">
          {active
            ? dir === "asc" ? <ChevronUp className="w-3 h-3 text-sky-400" /> : <ChevronDown className="w-3 h-3 text-sky-400" />
            : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />}
        </span>
      </div>
    </th>
  );
}

export default function ClustersPage() {
  const [clusters, setClusters] = useState<GkeCluster[]>([]);
  const [agentStatus, setAgentStatus] = useState<Map<string, ClusterAgentStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<GkeCluster | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap) => setClusters(snap.gkeClusters ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/agents/k8s/status")
      .then((r) => r.json())
      .then((data) => {
        const m = new Map<string, ClusterAgentStatus>();
        for (const c of data.clusters ?? []) {
          m.set(c.cluster_name, {
            clusterName: c.cluster_name,
            nodeCount: Number(c.node_count),
            healthyCount: Number(c.healthy_count ?? 0),
          });
        }
        setAgentStatus(m);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const toggleSort = useCallback(() => setSortDir((d) => d === "asc" ? "desc" : "asc"), []);

  const projectOptions = [...new Set(clusters.map((c) => c.projectId))].sort();

  const filtered = clusters
    .filter((c) =>
      (!projectFilter || c.projectId === projectFilter) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.projectId.toLowerCase().includes(search.toLowerCase()) ||
      c.location.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });

  function agentBadge(clusterName: string) {
    const s = agentStatus.get(clusterName);
    if (!s || s.nodeCount === 0) {
      return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize", AGENT_COLORS.none)}>Not deployed</span>;
    }
    if (s.nodeCount === s.healthyCount) {
      return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize", AGENT_COLORS.deployed)}>Deployed ({s.nodeCount})</span>;
    }
    return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize", AGENT_COLORS.partial)}>Partial ({s.healthyCount}/{s.nodeCount})</span>;
  }

  async function downloadManifest(cluster: GkeCluster) {
    const origin = window.location.origin;
    const resp = await fetch(`/api/agents/k8s/manifest?cluster=${encodeURIComponent(cluster.name)}&project=${encodeURIComponent(cluster.projectId)}&location=${encodeURIComponent(cluster.location)}`);
    const yaml = await resp.text();
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `watchmen-agent-${cluster.name}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deployAgent(cluster: GkeCluster) {
    setDeploying(cluster.name);
    setDeployError(null);
    try {
      const res = await fetch("/api/agents/k8s/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterName: cluster.name,
          projectId: cluster.projectId,
          location: cluster.location,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deploy failed");
      // Refresh agent status after deploy.
      const statusResp = await fetch("/api/agents/k8s/status");
      const statusData = await statusResp.json();
      const m = new Map<string, ClusterAgentStatus>();
      for (const c of statusData.clusters ?? []) {
        m.set(c.cluster_name, {
          clusterName: c.cluster_name,
          nodeCount: Number(c.node_count),
          healthyCount: Number(c.healthy_count ?? 0),
        });
      }
      setAgentStatus(m);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(null);
    }
  }

  const agentInfo = (name: string) => agentStatus.get(name);

  return (
    <>
      <div>
        <DetailPageHeader title="GKE Clusters" count={loading ? null : filtered.length} search={search} onSearch={setSearch} projects={projectOptions} projectFilter={projectFilter} onProjectFilter={setProjectFilter} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="mb-6">
          <EntryPointsPanel />
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Cluster" active dir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Location</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Nodes</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Agent</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(3)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((cluster) => {
                const isExpanded = expanded === cluster.name;
                const statusColor = STATUS_COLORS[cluster.status] ?? STATUS_COLORS.ERROR;
                return (
                  <Fragment key={cluster.name}>
                    <tr
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(cluster)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.name === cluster.name && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{cluster.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{cluster.projectId}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{cluster.location}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-md text-xs border",
                          cluster.locationType === "regional"
                            ? "text-sky-400 bg-sky-500/10 border-sky-500/20"
                            : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                        )}>
                          {cluster.locationType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", statusColor)}>
                          {cluster.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs tabular-nums">{cluster.nodeCount}</td>
                      <td className="px-4 py-3">{agentBadge(cluster.name)}</td>
                      <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : cluster.name); }}>
                        <button className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {cluster.iamPolicy.bindings.length}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-slate-700/30 bg-slate-900/40">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="space-y-2">
                            {cluster.iamPolicy.bindings.map((binding) => (
                              <div key={binding.role} className="flex items-start gap-3">
                                <span className="font-mono text-xs text-emerald-400 shrink-0 w-48 truncate">{binding.role.replace("roles/", "")}</span>
                                <div className="flex flex-wrap gap-1">
                                  {binding.members.map((m) => (
                                    <span key={m} className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-300 font-mono">
                                      {m.replace("user:", "").replace("serviceAccount:", "SA: ")}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No clusters found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={`${selected?.projectId} / ${selected?.location}`}
      >
        {selected && <ClusterDrawerContent cluster={selected} agentInfo={agentInfo(selected.name)} deploying={deploying === selected.name} deployError={deployError} onDownloadManifest={downloadManifest} onDeploy={deployAgent} />}
      </DetailDrawer>
    </>
  );
}

function ClusterDrawerContent({ cluster, agentInfo, deploying, deployError, onDownloadManifest, onDeploy }: {
  cluster: GkeCluster;
  agentInfo?: ClusterAgentStatus;
  deploying: boolean;
  deployError: string | null;
  onDownloadManifest: (c: GkeCluster) => void;
  onDeploy: (c: GkeCluster) => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    setEvents([]);
    setEventsLoading(true);
    fetch(`/api/agents/events/query?cluster=${encodeURIComponent(cluster.name)}&limit=20`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, [cluster.name]);

  const statusColor = STATUS_COLORS[cluster.status] ?? STATUS_COLORS.ERROR;

  const agentState = !agentInfo || agentInfo.nodeCount === 0 ? "none"
    : agentInfo.nodeCount === agentInfo.healthyCount ? "deployed" : "partial";

  const agentLabel = agentState === "none" ? "Not deployed"
    : agentState === "deployed" ? `Deployed (${agentInfo!.nodeCount} nodes)`
    : `Partial (${agentInfo!.healthyCount}/${agentInfo!.nodeCount} nodes)`;

  const agentColor = AGENT_COLORS[agentState] ?? AGENT_COLORS.none;

  return (
    <>
      <DrawerSection label="Cluster Details">
        <DrawerField label="Name" value={cluster.name} mono />
        <DrawerField label="Project" value={cluster.projectId} mono />
        <DrawerField label="Location" value={cluster.location} mono />
        <DrawerField label="Type" value={
          <span className={cn("px-2 py-0.5 rounded-md text-xs border",
            cluster.locationType === "regional"
              ? "text-sky-400 bg-sky-500/10 border-sky-500/20"
              : "text-slate-400 bg-slate-500/10 border-slate-500/20"
          )}>{cluster.locationType}</span>
        } />
        <DrawerField label="Status" value={
          <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", statusColor)}>{cluster.status}</span>
        } />
        <DrawerField label="K8s Version" value={cluster.currentMasterVersion} mono />
        <DrawerField label="Node Count" value={cluster.nodeCount} />
        {cluster.endpoint && <DrawerField label="API Endpoint" value={cluster.endpoint} mono />}
        <DrawerField label="Workload Identity" value={cluster.workloadIdentityEnabled ? "Enabled" : "Disabled"} />
        <DrawerField label="Private Cluster" value={cluster.privateCluster ? "Yes" : "No"} />
      </DrawerSection>

      <DrawerSection label="Watchmen Agent">
        <DrawerField label="Status" value={
          <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize", agentColor)}>
            {agentLabel}
          </span>
        } />
        {agentState === "none" && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-400">Deploy the Watchmen eBPF agent to this cluster to trace process execution events on every node.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onDeploy(cluster)}
                disabled={deploying}
                className="inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {deploying ? "Deploying..." : "Deploy Agent"}
              </button>
              <button
                type="button"
                onClick={() => onDownloadManifest(cluster)}
                className="inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/20"
              >
                Download Manifest
              </button>
            </div>
            {deployError && <p className="text-xs text-red-400">{deployError}</p>}
            <div className="text-xs text-slate-500 space-y-1">
              <p>Or apply manually:</p>
              <code className="block px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-300">
                kubectl create namespace watchmen 2&gt;/dev/null;{" "}
                kubectl create secret generic watchmen-agent-secret \<br />
                &nbsp;&nbsp;--from-literal=agent_secret="$(openssl rand -hex 32)" \<br />
                &nbsp;&nbsp;-n watchmen;{" "}
                kubectl apply -f watchmen-agent-{cluster.name}.yaml
              </code>
            </div>
          </div>
        )}
        {agentState !== "none" && (
          <div className="mt-2 space-y-2">
            <DrawerField label="Agent Nodes" value={`${agentInfo!.healthyCount} / ${agentInfo!.nodeCount} reporting`} />
            {agentInfo!.healthyCount < agentInfo!.nodeCount && (
              <p className="text-xs text-amber-300">Some nodes are not reporting. Check DaemonSet status with: kubectl rollout status daemonset/watchmen-ebpf-agent -n watchmen</p>
            )}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`Process Events (${events.length})`}>
        {eventsLoading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-500">No events received yet. Deploy the agent to start tracing.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {events.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-800/40 text-xs font-mono">
                <span className="text-slate-500 shrink-0 w-16">{e.received_at?.slice(11, 19)}</span>
                <span className="text-emerald-400 shrink-0 w-5 text-right">{e.event?.pid}</span>
                <span className="text-sky-300 shrink-0 max-w-[120px] truncate">{e.event?.comm}</span>
                <span className="text-slate-400 truncate">{e.event?.filename}</span>
              </div>
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`IAM Bindings (${cluster.iamPolicy.bindings.length})`}>
        {cluster.iamPolicy.bindings.length === 0 ? (
          <p className="text-xs text-slate-500">No IAM bindings found.</p>
        ) : (
          <div className="space-y-4">
            {cluster.iamPolicy.bindings.map((binding) => (
              <div key={binding.role} className="space-y-1.5">
                <p className="text-xs font-mono text-emerald-400">{binding.role.replace("roles/", "")}</p>
                <div className="flex flex-wrap gap-1 pl-2">
                  {binding.members.map((m) => (
                    <span key={m} className="px-2 py-0.5 rounded text-xs bg-slate-800 border border-slate-700/50 text-slate-300 font-mono">
                      {m.replace("user:", "").replace("serviceAccount:", "SA: ")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerSection>
    </>
  );
}
