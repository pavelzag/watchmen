"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ExternalLink } from "lucide-react";
import type { VM, GcpSnapshot, ProjectIamPolicy } from "@/lib/gcp/types";

type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

function fmt(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  STOPPED: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  TERMINATED: "text-red-400 bg-red-500/10 border-red-500/20",
  STAGING: "text-amber-400 bg-amber-500/10 border-amber-500/20",
};

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

export default function VMsPage() {
  const [vms, setVMs] = useState<VM[]>([]);
  const [projects, setProjects] = useState<ProjectIamPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<VM | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => {
        setVMs(snap.vms ?? []);
        setProjects(snap.projects ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const projectOptions = [...new Set(vms.map((v) => v.projectId))].sort();

  const filtered = vms
    .filter((v) =>
      (!projectFilter || v.projectId === projectFilter) &&
      (v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.projectId.toLowerCase().includes(search.toLowerCase()) ||
      v.zone.toLowerCase().includes(search.toLowerCase()) ||
      v.machineType.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div>
        <DetailPageHeader
          title="Virtual Machines"
          count={loading ? null : filtered.length}
          search={search}
          onSearch={setSearch}
          projects={projectOptions}
          projectFilter={projectFilter}
          onProjectFilter={setProjectFilter}
        />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Name" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Zone</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">External IP</th>
                <SortHeader label="Created" field="createdAt" current={sortField} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((vm) => {
                const statusColor = STATUS_COLORS[vm.status] ?? STATUS_COLORS.TERMINATED;
                return (
                  <tr
                    key={`${vm.projectId}/${vm.name}`}
                    onClick={() => setSelected(vm)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.name === vm.name && selected?.projectId === vm.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{vm.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{vm.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{vm.zone}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{vm.machineType}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", statusColor)}>
                        {vm.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {vm.externalIp ? (
                        <span className="flex items-center gap-1 font-mono text-orange-300">
                          {vm.externalIp}
                          <ExternalLink className="w-3 h-3 text-slate-500" />
                        </span>
                      ) : <span className="text-slate-500">Private</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmt(vm.createdAt)}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No VMs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={`${selected?.projectId} / ${selected?.zone}`}
      >
        {selected && <VMDrawerContent vm={selected} projects={projects} />}
      </DetailDrawer>
    </>
  );
}

function VMDrawerContent({ vm, projects }: { vm: VM; projects: ProjectIamPolicy[] }) {
  const project = projects.find((p) => p.projectId === vm.projectId);
  const computeBindings = (project?.bindings ?? []).filter((b) =>
    b.role.startsWith("roles/compute")
  );

  return (
    <>
      <DrawerSection label="Instance Details">
        <DrawerField label="Name" value={vm.name} mono />
        <DrawerField label="Project" value={vm.projectId} mono />
        <DrawerField label="Zone" value={vm.zone} mono />
        <DrawerField label="Machine Type" value={vm.machineType} mono />
        <DrawerField label="Created" value={fmt(vm.createdAt)} />
        <DrawerField
          label="Status"
          value={<StatusBadge active={vm.status === "RUNNING"} label={vm.status} />}
        />
      </DrawerSection>

      <DrawerSection label="Network">
        <DrawerField label="Internal IP" value={vm.internalIp || "—"} mono />
        <DrawerField
          label="External IP"
          value={
            vm.externalIp ? (
              <span className="flex items-center gap-1 text-orange-300 font-mono">
                {vm.externalIp}
                <ExternalLink className="w-3 h-3" />
              </span>
            ) : "Private only"
          }
        />
      </DrawerSection>

      {vm.serviceAccount && (
        <DrawerSection label="Service Account">
          <p className="text-xs font-mono text-sky-400 break-all">{vm.serviceAccount}</p>
        </DrawerSection>
      )}

      {vm.tags && vm.tags.length > 0 && (
        <DrawerSection label="Network Tags">
          <div className="flex flex-wrap gap-1.5">
            {vm.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-md text-xs font-mono bg-slate-800 border border-slate-700 text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        </DrawerSection>
      )}

      <DrawerSection label={`Compute IAM — ${vm.projectId}`}>
        {computeBindings.length === 0 ? (
          <p className="text-xs text-slate-500">No compute roles found at project level.</p>
        ) : (
          <div className="space-y-3">
            {computeBindings.map((binding) => (
              <div key={binding.role} className="space-y-1">
                <p className="text-xs font-mono text-emerald-400">{binding.role.replace("roles/", "")}</p>
                <div className="flex flex-wrap gap-1 pl-2">
                  {binding.members.map((m) => (
                    <span key={m} className="px-1.5 py-0.5 rounded text-xs bg-slate-800 border border-slate-700/50 text-slate-300 font-mono">
                      {m.replace("user:", "").replace("serviceAccount:", "SA:")}
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
