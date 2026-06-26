"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerField, DrawerSection } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import CopyTextButton from "@/components/CopyTextButton";
import { GCP_SCAN_CAPABILITIES, enrichGcpScanWarning } from "@/lib/gcp/scan-coverage";
import type { GcpScanWarning, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "service" | "projectId" | "code";
type SortDir = "asc" | "desc";
type CapabilityStatus = {
  state: "readable" | "blocked" | "not_checked";
  warning?: GcpScanWarning;
  blockedBy?: string;
};

function sortWarnings(warnings: GcpScanWarning[], sortField: SortField, sortDir: SortDir): GcpScanWarning[] {
  return [...warnings].sort((a, b) => {
    const cmp = sortField === "service"
      ? a.service.localeCompare(b.service)
      : sortField === "projectId"
        ? a.projectId.localeCompare(b.projectId)
        : a.code.localeCompare(b.code);
    return sortDir === "asc" ? cmp : -cmp;
  });
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
            ? dir === "asc"
              ? <ChevronUp className="w-3 h-3 text-sky-400" />
              : <ChevronDown className="w-3 h-3 text-sky-400" />
            : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />}
        </span>
      </div>
    </th>
  );
}

function codeLabel(code: GcpScanWarning["code"]): string {
  switch (code) {
    case "permission_denied":
      return "Permission denied";
    case "unauthenticated":
      return "Unauthenticated";
    case "api_not_enabled":
      return "API not enabled";
    case "timeout":
      return "Timed out";
    case "rate_limited":
      return "Rate limited";
    case "transient_network":
      return "Transient network";
    case "not_found":
      return "Not found";
    default:
      return "Unknown";
  }
}

function codeStyle(code: GcpScanWarning["code"]) {
  if (code === "permission_denied" || code === "unauthenticated") {
    return "bg-red-500/10 border-red-500/30 text-red-300";
  }
  if (code === "timeout" || code === "rate_limited" || code === "transient_network") {
    return "bg-amber-500/10 border-amber-500/30 text-amber-300";
  }
  return "bg-slate-500/10 border-slate-500/30 text-slate-300";
}

function allCommands(warning: GcpScanWarning): string[] {
  const commands: string[] = [];
  if (warning.code === "api_not_enabled" && warning.enableApiCommand) commands.push(warning.enableApiCommand);
  commands.push(...(warning.grantCommands ?? []));
  return commands;
}

function capabilityStatus(
  service: string,
  warningByService: Map<string, GcpScanWarning[]>
): CapabilityStatus {
  const warning = warningByService.get(service)?.[0];
  if (warning) return { state: "blocked", warning };

  const capability = GCP_SCAN_CAPABILITIES.find((item) => item.service === service);
  const blockedDependency = capability?.dependsOn?.find((dependency) => warningByService.has(dependency));
  if (blockedDependency) return { state: "not_checked", blockedBy: blockedDependency };

  return { state: "readable" };
}

export default function ScanCoveragePage() {
  const [warnings, setWarnings] = useState<GcpScanWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("service");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<GcpScanWarning | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/snapshot");
      if (!res.ok) throw new Error("Failed to load GCP data");
      const snap: GcpSnapshot = await res.json();
      setWarnings((snap.scanWarnings ?? []).map(enrichGcpScanWarning));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const services = useMemo(() => [...new Set(warnings.map((warning) => warning.service))].sort(), [warnings]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sortWarnings(
      warnings.filter((warning) =>
        (!serviceFilter || warning.service === serviceFilter) &&
        (!q ||
          warning.service.toLowerCase().includes(q) ||
          warning.projectId.toLowerCase().includes(q) ||
          warning.code.toLowerCase().includes(q) ||
          warning.message.toLowerCase().includes(q))
      ),
      sortField,
      sortDir
    );
  }, [warnings, serviceFilter, search, sortField, sortDir]);

  const accessIssues = warnings.filter((warning) => warning.code === "permission_denied" || warning.code === "unauthenticated").length;
  const warningByService = useMemo(() => {
    const map = new Map<string, GcpScanWarning[]>();
    for (const warning of warnings) {
      map.set(warning.service, [...(map.get(warning.service) ?? []), warning]);
    }
    return map;
  }, [warnings]);
  const blockedServices = GCP_SCAN_CAPABILITIES.filter((capability) => warningByService.has(capability.service)).length;
  const notCheckedServices = GCP_SCAN_CAPABILITIES.filter((capability) => capabilityStatus(capability.service, warningByService).state === "not_checked").length;
  const readableServices = GCP_SCAN_CAPABILITIES.length - blockedServices - notCheckedServices;
  const scannerPrincipal = warnings.find((warning) => warning.principal)?.principal;

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <DetailPageHeader
            title="Scan Coverage"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
            projects={services}
            projectFilter={serviceFilter}
            onProjectFilter={setServiceFilter}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <ExportButton
              data={filtered.map((warning) => ({
                service: warning.service,
                projectId: warning.projectId,
                code: warning.code,
                retryable: warning.retryable,
                message: warning.message,
                detail: warning.detail ?? "",
                principal: warning.principal ?? "",
                requiredRoles: warning.requiredRoles?.join(", ") ?? "",
                requiredApi: warning.requiredApi ?? "",
                commands: allCommands(warning).join("\n"),
              }))}
              filename="scan-coverage"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: "Readable services", value: readableServices, color: "#34d399" },
            { label: "Access-related", value: accessIssues, color: "#f87171" },
            { label: "Blocked / unchecked", value: blockedServices + notCheckedServices, color: "#fbbf24" },
          ].map((item) => (
            <div key={item.label} className="glass rounded-xl px-4 py-3 border border-slate-700/50">
              <p className="text-xs uppercase tracking-wider text-slate-500">{item.label}</p>
              <p className="text-2xl font-semibold" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="px-4 py-3 text-sm text-red-400 rounded-xl bg-red-500/10 border border-red-500/20">
            {error}
          </div>
        )}

        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/40">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">GCP Account Coverage</h2>
            <p className="text-xs text-slate-500 mt-1">Shows what the connected account can read in the latest scan and which grants unblock missing areas.</p>
            {scannerPrincipal && <p className="text-xs text-slate-500 mt-1">Scanner principal: <span className="font-mono text-slate-300">{scannerPrincipal}</span></p>}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Area</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Watchmen Can Show</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Required Roles</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Command</th>
              </tr>
            </thead>
            <tbody>
              {GCP_SCAN_CAPABILITIES.map((capability) => {
                const status = capabilityStatus(capability.service, warningByService);
                const commands = status.warning ? allCommands(status.warning) : [];
                return (
                  <tr key={capability.service} className="border-t border-slate-700/30">
                    <td className="px-4 py-3">
                      <p className="text-xs font-mono text-slate-200">{capability.label}</p>
                      {capability.api && <p className="text-[10px] text-slate-500 mt-0.5">{capability.api}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {status.state === "blocked" && status.warning ? (
                        <span className={`px-2 py-0.5 rounded border text-xs ${codeStyle(status.warning.code)}`}>{codeLabel(status.warning.code)}</span>
                      ) : status.state === "not_checked" ? (
                        <span className="px-2 py-0.5 rounded border text-xs bg-slate-500/10 border-slate-500/30 text-slate-300">Not checked</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded border text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-300">Readable</span>
                      )}
                      {status.blockedBy && <p className="text-[10px] text-slate-500 mt-1">Blocked by {status.blockedBy}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 max-w-sm">{capability.shows}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {capability.roles.map((role) => (
                          <span key={role} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/50">{role}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {commands.length > 0 ? (
                        <CopyTextButton
                          text={commands.join("\n")}
                          label="Copy grants"
                          className="flex items-center gap-1 text-[10px] font-mono"
                          style={{ color: "#cbd5e1" }}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">No action needed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Service" field="service" current={sortField} dir={sortDir} onSort={(field) => {
                  setSortDir((dir) => field === sortField ? (dir === "asc" ? "desc" : "asc") : "asc");
                  setSortField(field);
                }} />
                <SortHeader label="Project" field="projectId" current={sortField} dir={sortDir} onSort={(field) => {
                  setSortDir((dir) => field === sortField ? (dir === "asc" ? "desc" : "asc") : "asc");
                  setSortField(field);
                }} />
                <SortHeader label="Status" field="code" current={sortField} dir={sortDir} onSort={(field) => {
                  setSortDir((dir) => field === sortField ? (dir === "asc" ? "desc" : "asc") : "asc");
                  setSortField(field);
                }} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Retryable</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Message</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((warning, index) => (
                <tr
                  key={`${warning.service}-${warning.projectId}-${warning.code}-${index}`}
                  data-nav
                  tabIndex={0}
                  onClick={() => setSelected(warning)}
                  className="border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5"
                >
                  <td className="px-4 py-3 text-xs text-slate-200 font-mono">{warning.service}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono">{warning.projectId}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`px-2 py-0.5 rounded border ${codeStyle(warning.code)}`}>
                      {codeLabel(warning.code)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{warning.retryable ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />
                        <span>{warning.message}</span>
                      </div>
                      <CopyTextButton
                        text={[warning.message, warning.detail].filter(Boolean).join("\n\n")}
                        label="Copy"
                        className="flex items-center gap-1 text-[10px] font-mono shrink-0"
                        style={{ color: "#cbd5e1" }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No scan coverage warnings found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.service} / ${selected.projectId}` : ""}
        subtitle={selected ? codeLabel(selected.code) : ""}
      >
        {selected && (
          <>
            <DrawerSection label="Coverage Status">
              <DrawerField label="Service" value={selected.service} mono />
              <DrawerField label="Project" value={selected.projectId} mono />
              <DrawerField label="Code" value={selected.code} mono />
              <DrawerField label="Retryable" value={selected.retryable ? "Yes" : "No"} />
            </DrawerSection>
            <DrawerSection label="Message">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-300 leading-relaxed">{selected.message}</p>
                <CopyTextButton
                  text={selected.message}
                  label="Copy"
                  className="flex items-center gap-1 text-[10px] font-mono shrink-0"
                  style={{ color: "#cbd5e1" }}
                />
              </div>
            </DrawerSection>
            {selected.detail && (
              <DrawerSection label="Technical Detail">
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <CopyTextButton
                      text={selected.detail}
                      label="Copy detail"
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "#cbd5e1" }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 font-mono whitespace-pre-wrap break-all">{selected.detail}</p>
                </div>
              </DrawerSection>
            )}
            {allCommands(selected).length > 0 && (
              <DrawerSection label="Grant Commands">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <CopyTextButton
                      text={allCommands(selected).join("\n")}
                      label="Copy commands"
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "#cbd5e1" }}
                    />
                  </div>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-all rounded-lg border border-slate-700/40 bg-slate-950/50 p-3">{allCommands(selected).join("\n")}</pre>
                </div>
              </DrawerSection>
            )}
          </>
        )}
      </DetailDrawer>
    </>
  );
}
