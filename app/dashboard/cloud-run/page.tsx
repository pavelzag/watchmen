"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ExternalLink, AlertTriangle } from "lucide-react";
import type { CloudRunService, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "name" | "region" | "status";
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

export default function CloudRunPage() {
  const [services, setServices] = useState<CloudRunService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<CloudRunService | null>(null);

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setServices(snap.cloudRunServices ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const filtered = services
    .filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.projectId.toLowerCase().includes(search.toLowerCase()) ||
      s.region.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "region") cmp = a.region.localeCompare(b.region);
      else cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const isPublic = (svc: CloudRunService) =>
    svc.iamPolicy.bindings.some((b) =>
      b.members.some((m) => m === "allUsers" || m === "allAuthenticatedUsers")
    );

  return (
    <>
      <div>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <DetailPageHeader
            title="Cloud Run Services"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
          />
          <ExportButton
            data={filtered.map((s) => ({ name: s.name, project: s.projectId, region: s.region, status: s.status, url: s.url ?? "", serviceAccount: s.serviceAccount ?? "" }))}
            filename="cloud-run-services"
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
                <SortHeader label="Status" field="status" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">URL</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((svc) => {
                const pub = isPublic(svc);
                return (
                  <tr
                    key={`${svc.projectId}/${svc.name}`}
                    onClick={() => setSelected(svc)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.name === svc.name && selected?.projectId === svc.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{svc.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{svc.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{svc.region}</td>
                    <td className="px-4 py-3">
                      <StatusBadge active={svc.status === "ACTIVE"} label={svc.status} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {svc.url ? (
                        <a
                          href={svc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-mono truncate max-w-[180px]"
                        >
                          {svc.url.replace("https://", "")}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {pub ? (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertTriangle className="w-3 h-3" /> Public
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Private</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No Cloud Run services found.</td></tr>
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
          <>
            <DrawerSection label="Service Details">
              <DrawerField label="Name" value={selected.name} mono />
              <DrawerField label="Project" value={selected.projectId} mono />
              <DrawerField label="Region" value={selected.region} mono />
              <DrawerField label="Status" value={<StatusBadge active={selected.status === "ACTIVE"} label={selected.status} />} />
              {selected.serviceAccount && <DrawerField label="Service Account" value={selected.serviceAccount} mono />}
            </DrawerSection>
            {selected.url && (
              <DrawerSection label="URL">
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300 font-mono break-all flex items-center gap-1">
                  {selected.url} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </DrawerSection>
            )}
            <DrawerSection label="IAM Policy">
              {selected.iamPolicy.bindings.length === 0 ? (
                <p className="text-xs text-slate-500">No bindings.</p>
              ) : (
                <div className="space-y-3">
                  {selected.iamPolicy.bindings.map((b) => (
                    <div key={b.role}>
                      <p className="text-xs font-mono text-emerald-400 mb-1">{b.role.replace("roles/", "")}</p>
                      <div className="flex flex-wrap gap-1 pl-2">
                        {b.members.map((m) => (
                          <span key={m} className={cn("px-1.5 py-0.5 rounded text-xs border font-mono",
                            (m === "allUsers" || m === "allAuthenticatedUsers")
                              ? "bg-red-500/10 border-red-500/30 text-red-400"
                              : "bg-slate-800 border-slate-700/50 text-slate-300"
                          )}>
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
        )}
      </DetailDrawer>
    </>
  );
}
