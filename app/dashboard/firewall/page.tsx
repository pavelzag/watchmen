"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import type { FirewallRule, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "name" | "priority" | "direction";
type SortDir = "asc" | "desc";

const OPEN_RANGES = new Set(["0.0.0.0/0", "::/0"]);

function isOpenToInternet(rule: FirewallRule): boolean {
  return rule.direction === "INGRESS" &&
    !rule.disabled &&
    (rule.sourceRanges ?? []).some((r) => OPEN_RANGES.has(r));
}

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

export default function FirewallPage() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<FirewallRule | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setRules(snap.firewallRules ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const projectOptions = [...new Set(rules.map((r) => r.projectId))].sort();

  const filtered = rules
    .filter((r) =>
      (!projectFilter || r.projectId === projectFilter) &&
      (r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.projectId.toLowerCase().includes(search.toLowerCase()) ||
      r.network.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "priority") cmp = a.priority - b.priority;
      else cmp = a.direction.localeCompare(b.direction);
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <DetailPageHeader
            title="Firewall Rules"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
            projects={projectOptions}
            projectFilter={projectFilter}
            onProjectFilter={setProjectFilter}
          />
          <ExportButton
            data={filtered.map((r) => ({ name: r.name, project: r.projectId, network: r.network, direction: r.direction, priority: r.priority, sourceRanges: (r.sourceRanges ?? []).join("; "), disabled: r.disabled }))}
            filename="firewall-rules"
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Rule" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Network</th>
                <SortHeader label="Direction" field="direction" current={sortField} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Priority" field="priority" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Source Ranges</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((rule) => {
                const open = isOpenToInternet(rule);
                return (
                  <tr
                    key={`${rule.projectId}/${rule.name}`}
                    onClick={() => setSelected(rule)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      open && !rule.disabled && "bg-red-500/5 hover:bg-red-500/10",
                      selected?.name === rule.name && selected?.projectId === rule.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 text-xs">
                      <span className={cn("font-mono", open && !rule.disabled ? "text-red-300" : "text-slate-200")}>
                        {open && !rule.disabled && <AlertTriangle className="w-3 h-3 inline mr-1 text-red-400" />}
                        {rule.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{rule.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono truncate max-w-[120px]">
                      {rule.network.split("/").pop()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("flex items-center gap-1 text-xs font-medium",
                        rule.direction === "INGRESS" ? "text-sky-400" : "text-violet-400"
                      )}>
                        {rule.direction === "INGRESS"
                          ? <ArrowDown className="w-3 h-3" />
                          : <ArrowUp className="w-3 h-3" />}
                        {rule.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">{rule.priority}</td>
                    <td className="px-4 py-3 text-xs">
                      {(rule.sourceRanges ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(rule.sourceRanges ?? []).map((r) => (
                            <span key={r} className={cn("px-1.5 py-0.5 rounded font-mono text-xs border",
                              OPEN_RANGES.has(r)
                                ? "bg-red-500/10 border-red-500/30 text-red-400"
                                : "bg-slate-800 border-slate-700/50 text-slate-300"
                            )}>{r}</span>
                          ))}
                        </div>
                      ) : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={!rule.disabled} label={rule.disabled ? "Disabled" : "Active"} />
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No firewall rules found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={`${selected?.projectId} / ${selected?.direction}`}
      >
        {selected && (
          <>
            <DrawerSection label="Rule Details">
              <DrawerField label="Name" value={selected.name} mono />
              <DrawerField label="Project" value={selected.projectId} mono />
              <DrawerField label="Network" value={selected.network.split("/").pop() ?? selected.network} mono />
              <DrawerField label="Direction" value={selected.direction} mono />
              <DrawerField label="Priority" value={String(selected.priority)} mono />
              <DrawerField label="Status" value={<StatusBadge active={!selected.disabled} label={selected.disabled ? "Disabled" : "Active"} />} />
            </DrawerSection>

            {(selected.sourceRanges ?? []).length > 0 && (
              <DrawerSection label="Source Ranges">
                <div className="flex flex-wrap gap-1.5">
                  {(selected.sourceRanges ?? []).map((r) => (
                    <span key={r} className={cn("px-2 py-0.5 rounded font-mono text-xs border",
                      OPEN_RANGES.has(r)
                        ? "bg-red-500/10 border-red-500/30 text-red-400"
                        : "bg-slate-800 border-slate-700/50 text-slate-300"
                    )}>{r}</span>
                  ))}
                </div>
              </DrawerSection>
            )}

            {(selected.targetTags ?? []).length > 0 && (
              <DrawerSection label="Target Tags">
                <div className="flex flex-wrap gap-1.5">
                  {(selected.targetTags ?? []).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded font-mono text-xs bg-slate-800 border border-slate-700/50 text-slate-300">{t}</span>
                  ))}
                </div>
              </DrawerSection>
            )}

            <DrawerSection label="Allowed Protocols">
              {selected.allowed.length === 0 ? (
                <p className="text-xs text-slate-500">No protocols (deny rule).</p>
              ) : (
                <div className="space-y-1">
                  {selected.allowed.map((a, i) => (
                    <p key={i} className="text-xs font-mono text-slate-300">
                      {a.IPProtocol}{a.ports?.length ? `:${a.ports.join(", ")}` : " (all ports)"}
                    </p>
                  ))}
                </div>
              )}
            </DrawerSection>
          </>
        )}
      </DetailDrawer>
    </>
  );
}
