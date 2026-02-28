"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import type { CloudSqlInstance, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "name" | "region" | "state";
type SortDir = "asc" | "desc";

function SortHeader({
  label, field, current, dir, onSort,
}: { label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void }) {
  const active = field === current;
  return (
    <th className="px-4 py-3 text-left cursor-pointer select-none group" onClick={() => onSort(field)}>
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

const STATE_COLORS: Record<string, string> = {
  RUNNABLE: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  SUSPENDED: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  MAINTENANCE: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  FAILED: "text-red-400 bg-red-500/10 border-red-500/20",
};

export default function CloudSqlPage() {
  const [instances, setInstances] = useState<CloudSqlInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<CloudSqlInstance | null>(null);

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setInstances(snap.cloudSqlInstances ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const filtered = instances
    .filter((i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.projectId.toLowerCase().includes(search.toLowerCase()) ||
      i.region.toLowerCase().includes(search.toLowerCase()) ||
      i.databaseVersion.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "region") cmp = a.region.localeCompare(b.region);
      else cmp = a.state.localeCompare(b.state);
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <DetailPageHeader
            title="Cloud SQL Instances"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
          />
          <ExportButton
            data={filtered.map((i) => ({ name: i.name, project: i.projectId, region: i.region, databaseVersion: i.databaseVersion, tier: i.tier, state: i.state, publicIp: i.publicIp ?? "" }))}
            filename="cloud-sql-instances"
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Name" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <SortHeader label="Region" field="region" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">DB Version</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Tier</th>
                <SortHeader label="State" field="state" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Public IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((inst) => {
                const stateColor = STATE_COLORS[inst.state] ?? STATE_COLORS.FAILED;
                return (
                  <tr
                    key={`${inst.projectId}/${inst.name}`}
                    onClick={() => setSelected(inst)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.name === inst.name && selected?.projectId === inst.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{inst.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{inst.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{inst.region}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-300">{inst.databaseVersion}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{inst.tier}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", stateColor)}>
                        {inst.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {inst.publicIp ? (
                        <span className="flex items-center gap-1 font-mono text-orange-300">
                          <AlertTriangle className="w-3 h-3 text-orange-400" />
                          {inst.publicIp}
                        </span>
                      ) : <span className="text-slate-500">Private</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No Cloud SQL instances found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={`${selected?.projectId} / ${selected?.region}`}
      >
        {selected && (
          <DrawerSection label="Instance Details">
            <DrawerField label="Name" value={selected.name} mono />
            <DrawerField label="Project" value={selected.projectId} mono />
            <DrawerField label="Region" value={selected.region} mono />
            <DrawerField label="DB Version" value={selected.databaseVersion} mono />
            <DrawerField label="Tier" value={selected.tier} mono />
            <DrawerField label="State" value={<StatusBadge active={selected.state === "RUNNABLE"} label={selected.state} />} />
            <DrawerField
              label="Public IP"
              value={selected.publicIp
                ? <span className="font-mono text-orange-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{selected.publicIp}</span>
                : "Private only"}
            />
          </DrawerSection>
        )}
      </DetailDrawer>
    </>
  );
}
