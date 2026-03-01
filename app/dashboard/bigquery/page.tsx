"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import type { BigQueryDataset, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "datasetId" | "location";
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

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

export default function BigQueryPage() {
  const [datasets, setDatasets] = useState<BigQueryDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("datasetId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<BigQueryDataset | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setDatasets(snap.bigqueryDatasets ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const projectOptions = [...new Set(datasets.map((d) => d.projectId))].sort();

  const filtered = datasets
    .filter((d) =>
      (!projectFilter || d.projectId === projectFilter) &&
      (d.datasetId.toLowerCase().includes(search.toLowerCase()) ||
      d.projectId.toLowerCase().includes(search.toLowerCase()) ||
      d.location.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      const cmp = sortField === "datasetId"
        ? a.datasetId.localeCompare(b.datasetId)
        : a.location.localeCompare(b.location);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const memberCount = (ds: BigQueryDataset) =>
    new Set(ds.iamPolicy.bindings.flatMap((b) => b.members)).size;

  const isPublic = (ds: BigQueryDataset) =>
    ds.iamPolicy.bindings.some((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)));

  return (
    <>
      <div>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <DetailPageHeader
            title="BigQuery Datasets"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
            projects={projectOptions}
            projectFilter={projectFilter}
            onProjectFilter={setProjectFilter}
          />
          <ExportButton
            data={filtered.map((d) => ({ datasetId: d.datasetId, project: d.projectId, location: d.location, members: memberCount(d) }))}
            filename="bigquery-datasets"
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Dataset ID" field="datasetId" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <SortHeader label="Location" field="location" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Members</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((ds) => {
                const pub = isPublic(ds);
                return (
                  <tr
                    key={`${ds.projectId}/${ds.datasetId}`}
                    onClick={() => setSelected(ds)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.datasetId === ds.datasetId && selected?.projectId === ds.projectId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{ds.datasetId}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{ds.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{ds.location}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{memberCount(ds)}</td>
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
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No BigQuery datasets found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.datasetId ?? ""}
        subtitle={selected?.projectId}
      >
        {selected && (
          <>
            <DrawerSection label="Dataset Details">
              <DrawerField label="Dataset ID" value={selected.datasetId} mono />
              <DrawerField label="Project" value={selected.projectId} mono />
              <DrawerField label="Location" value={selected.location} mono />
            </DrawerSection>
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
                            PUBLIC_MEMBERS.has(m)
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
