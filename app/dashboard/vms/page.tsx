"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ExternalLink, Download, RefreshCw } from "lucide-react";
import type { VM, GcpSnapshot, ProjectIamPolicy } from "@/lib/gcp/types";

type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

type AgentHost = {
  projectId: string;
  zone: string;
  instanceId: string;
  instanceName: string;
  status: string;
  lastSeenAt: string;
};

type AgentReport = {
  projectId: string;
  zone: string;
  instance: string;
  complianceState: string;
  reason?: string;
  updatedAt?: string;
};

type AgentInstallState = {
  hosts: AgentHost[];
  reports: AgentReport[];
  jobs: { id: string; status: string; projectId: string; selectedInstances: { name: string; zone: string }[]; error?: string | null }[];
  canAutomate: boolean;
  binaryConfigured: boolean;
};

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
  const [agentState, setAgentState] = useState<AgentInstallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentLoading, setAgentLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<VM | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState("");

  const loadAgentState = useCallback(() => {
    setAgentLoading(true);
    setAgentError(null);
    fetch("/api/agents/gcp/installations")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load agent status");
        setAgentState(data);
      })
      .catch((e) => setAgentError(e.message))
      .finally(() => setAgentLoading(false));
  }, []);

  const loadSnapshot = useCallback(() => {
    setLoading(true);
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => {
        setVMs(snap.vms ?? []);
        setProjects(snap.projects ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSnapshot();
    loadAgentState();
  }, [loadSnapshot, loadAgentState]);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
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

  const visibleKeys = filtered.map(vmKey);
  const selectable = filtered.filter((vm) => vm.status === "RUNNING");
  const selectedVMs = vms.filter((vm) => selectedKeys.has(vmKey(vm)));
  const selectedRunnable = selectedVMs.filter((vm) => vm.status === "RUNNING");
  const allVisibleSelected = selectable.length > 0 && selectable.every((vm) => selectedKeys.has(vmKey(vm)));

  function toggleVM(vm: VM) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const key = vmKey(vm);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVisible() {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const key of visibleKeys) next.delete(key);
      } else {
        for (const vm of selectable) next.add(vmKey(vm));
      }
      return next;
    });
  }

  async function installSelected() {
    if (selectedRunnable.length === 0) return;
    setInstalling(true);
    setAgentError(null);
    try {
      const res = await fetch("/api/agents/gcp/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: selectedRunnable.map((vm) => ({
            projectId: vm.projectId,
            zone: vm.zone,
            name: vm.name,
            id: vm.id,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Install request failed");
      setSelectedKeys(new Set());
      loadAgentState();
      loadSnapshot();
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

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
        {agentError && <p className="text-sm text-red-400 mb-4">{agentError}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={installSelected}
            disabled={installing || selectedRunnable.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {installing ? "Installing..." : `Install Agent (${selectedRunnable.length})`}
          </button>
          <button
            type="button"
            onClick={loadAgentState}
            disabled={agentLoading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700/70 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", agentLoading && "animate-spin")} />
            Refresh Agent Status
          </button>
          {agentState && !agentState.binaryConfigured && (
            <span className="text-xs text-amber-300">WATCHMEN_AGENT_BINARY_URL is not configured.</span>
          )}
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisible}
                    aria-label="Select visible running VMs"
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                </th>
                <SortHeader label="Name" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Zone</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Agent</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">External IP</th>
                <SortHeader label="Created" field="createdAt" current={sortField} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(9)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((vm) => {
                const statusColor = STATUS_COLORS[vm.status] ?? STATUS_COLORS.TERMINATED;
                const agent = getAgentStatus(vm, agentState);
                return (
                  <tr
                    key={`${vm.projectId}/${vm.name}`}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(vm)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.name === vm.name && selected?.projectId === vm.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(vmKey(vm))}
                        disabled={vm.status !== "RUNNING"}
                        onChange={() => toggleVM(vm)}
                        aria-label={`Select ${vm.name}`}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 disabled:opacity-30"
                      />
                    </td>
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
                    <td className="px-4 py-3">
                      <AgentBadge state={agent.state} detail={agent.detail} />
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
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">No VMs found.</td></tr>
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
        {selected && <VMDrawerContent vm={selected} projects={projects} agentState={agentState} />}
      </DetailDrawer>
    </>
  );
}

function vmKey(vm: VM) {
  return `${vm.projectId}/${vm.zone}/${vm.id ?? vm.name}`;
}

function normalizeZone(zone: string) {
  return zone.includes("/") ? zone.split("/").pop() ?? zone : zone;
}

function getAgentStatus(vm: VM, state: AgentInstallState | null): { state: string; detail?: string } {
  const host = state?.hosts.find((h) =>
    h.projectId === vm.projectId &&
    normalizeZone(h.zone) === normalizeZone(vm.zone) &&
    ((vm.id && h.instanceId === vm.id) || h.instanceName === vm.name)
  );
  if (host) return { state: "registered", detail: `Last seen ${fmt(host.lastSeenAt)}` };

  const report = state?.reports.find((r) =>
    r.projectId === vm.projectId &&
    normalizeZone(r.zone) === normalizeZone(vm.zone) &&
    (r.instance === vm.name || r.instance === vm.id)
  );
  if (report) return { state: report.complianceState.toLowerCase(), detail: report.reason };

  if (vm.labels?.["watchmen-agent"] === "enabled") return { state: "assigned" };
  return { state: "not_installed" };
}

function AgentBadge({ state, detail }: { state: string; detail?: string }) {
  const colors: Record<string, string> = {
    registered: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    compliant: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    assigned: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    unknown: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    non_compliant: "border-red-500/30 bg-red-500/10 text-red-300",
    not_installed: "border-slate-700 bg-slate-800/60 text-slate-400",
  };
  const label = state.replace(/_/g, " ");
  return (
    <span
      title={detail}
      className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize", colors[state] ?? colors.unknown)}
    >
      {label}
    </span>
  );
}

function VMDrawerContent({ vm, projects, agentState }: { vm: VM; projects: ProjectIamPolicy[]; agentState: AgentInstallState | null }) {
  const project = projects.find((p) => p.projectId === vm.projectId);
  const computeBindings = (project?.bindings ?? []).filter((b) =>
    b.role.startsWith("roles/compute")
  );
  const agent = getAgentStatus(vm, agentState);

  return (
    <>
      <DrawerSection label="Instance Details">
        <DrawerField label="Name" value={vm.name} mono />
        <DrawerField label="Instance ID" value={vm.id || "—"} mono />
        <DrawerField label="Project" value={vm.projectId} mono />
        <DrawerField label="Zone" value={vm.zone} mono />
        <DrawerField label="Machine Type" value={vm.machineType} mono />
        <DrawerField label="Created" value={fmt(vm.createdAt)} />
        <DrawerField
          label="Status"
          value={<StatusBadge active={vm.status === "RUNNING"} label={vm.status} />}
        />
      </DrawerSection>

      <DrawerSection label="Watchmen Agent">
        <DrawerField label="Status" value={<AgentBadge state={agent.state} detail={agent.detail} />} />
        <DrawerField label="Detail" value={agent.detail || "—"} />
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
