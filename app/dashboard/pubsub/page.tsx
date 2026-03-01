"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import ExportButton from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import type { PubSubTopic, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "name" | "projectId";
type SortDir = "asc" | "desc";

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

function topicShortName(name: string) {
  return name.split("/").pop() ?? name;
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

export default function PubSubPage() {
  const [topics, setTopics] = useState<PubSubTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<PubSubTopic | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setTopics(snap.pubsubTopics ?? []))
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

  const projectOptions = [...new Set(topics.map((t) => t.projectId))].sort();

  const filtered = topics
    .filter((t) =>
      (!projectFilter || t.projectId === projectFilter) &&
      (t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.projectId.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      const cmp = sortField === "name"
        ? a.name.localeCompare(b.name)
        : a.projectId.localeCompare(b.projectId);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const memberCount = (t: PubSubTopic) =>
    new Set(t.iamPolicy.bindings.flatMap((b) => b.members)).size;

  const isPublic = (t: PubSubTopic) =>
    t.iamPolicy.bindings.some((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)));

  return (
    <>
      <div>
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <DetailPageHeader
            title="Pub/Sub Topics"
            count={loading ? null : filtered.length}
            search={search}
            onSearch={setSearch}
            projects={projectOptions}
            projectFilter={projectFilter}
            onProjectFilter={setProjectFilter}
          />
          <ExportButton
            data={filtered.map((t) => ({ topic: topicShortName(t.name), fullName: t.name, project: t.projectId, members: memberCount(t) }))}
            filename="pubsub-topics"
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Topic" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Project" field="projectId" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Members</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(4)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((topic) => {
                const pub = isPublic(topic);
                return (
                  <tr
                    key={topic.name}
                    onClick={() => setSelected(topic)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.name === topic.name && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{topicShortName(topic.name)}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{topic.projectId}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{memberCount(topic)}</td>
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
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">No Pub/Sub topics found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? topicShortName(selected.name) : ""}
        subtitle={selected?.projectId}
      >
        {selected && (
          <>
            <DrawerSection label="Topic Details">
              <DrawerField label="Short Name" value={topicShortName(selected.name)} mono />
              <DrawerField label="Full Name" value={selected.name} mono />
              <DrawerField label="Project" value={selected.projectId} mono />
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
