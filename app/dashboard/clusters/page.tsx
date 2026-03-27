"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { GkeCluster } from "@/lib/gcp/types";
import EntryPointsPanel from "./EntryPointsPanel";

type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  PROVISIONING: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  STOPPING: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  ERROR: "text-red-400 bg-red-500/10 border-red-500/20",
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
  const [loading, setLoading] = useState(true);
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
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(3)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
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
                      <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : cluster.name); }}>
                        <button className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {cluster.iamPolicy.bindings.length}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-slate-700/30 bg-slate-900/40">
                        <td colSpan={7} className="px-6 py-4">
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
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No clusters found.</td></tr>
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
        {selected && <ClusterDrawerContent cluster={selected} />}
      </DetailDrawer>
    </>
  );
}

function ClusterDrawerContent({ cluster }: { cluster: GkeCluster }) {
  const statusColor = STATUS_COLORS[cluster.status] ?? STATUS_COLORS.ERROR;
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
