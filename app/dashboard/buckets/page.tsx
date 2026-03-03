"use client";

import { useEffect, useState, Fragment } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { StorageBucket } from "@/lib/gcp/types";

const CLASS_COLORS: Record<string, string> = {
  STANDARD: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  NEARLINE: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  COLDLINE: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  ARCHIVE: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function isPublic(bucket: StorageBucket) {
  return bucket.iamPolicy.bindings.some((b) =>
    b.members.some((m) => m === "allUsers" || m === "allAuthenticatedUsers")
  );
}

export default function BucketsPage() {
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<StorageBucket | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap) => setBuckets(snap.storageBuckets ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const projectOptions = [...new Set(buckets.map((b) => b.projectId))].sort();

  const filtered = buckets.filter(
    (b) =>
      (!projectFilter || b.projectId === projectFilter) &&
      (b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.projectId.toLowerCase().includes(search.toLowerCase()) ||
      b.location.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader title="Storage Buckets" count={loading ? null : filtered.length} search={search} onSearch={setSearch} projects={projectOptions} projectFilter={projectFilter} onProjectFilter={setProjectFilter} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Bucket</th>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Access</th>
                <th className="px-4 py-3 text-left">Members</th>
                <th className="px-4 py-3 text-left">IAM</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((bucket) => {
                const memberCount = new Set(bucket.iamPolicy.bindings.flatMap((b) => b.members)).size;
                const isExpanded = expanded === bucket.name;
                const pub = isPublic(bucket);
                return (
                  <Fragment key={bucket.name}>
                    <tr
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(bucket)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.name === bucket.name && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{bucket.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{bucket.projectId}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{bucket.location}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", CLASS_COLORS[bucket.storageClass] ?? CLASS_COLORS.STANDARD)}>
                          {bucket.storageClass}
                        </span>
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
                      <td className="px-4 py-3 text-slate-300 text-xs">{memberCount}</td>
                      <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : bucket.name); }}>
                        <button className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors">
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {bucket.iamPolicy.bindings.length} bindings
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-slate-700/30 bg-slate-900/40">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="space-y-2">
                            {bucket.iamPolicy.bindings.map((binding) => (
                              <div key={binding.role} className="flex items-start gap-3">
                                <span className="font-mono text-xs text-sky-400 shrink-0 w-48 truncate">{binding.role.replace("roles/", "")}</span>
                                <div className="flex flex-wrap gap-1">
                                  {binding.members.map((m) => (
                                    <span key={m} className={cn(
                                      "px-1.5 py-0.5 rounded text-xs font-mono",
                                      m === "allUsers" ? "bg-red-900/40 text-red-300 border border-red-700/50" : "bg-slate-700 text-slate-300"
                                    )}>
                                      {m.replace("user:", "").replace("serviceAccount:", "SA: ").replace("allUsers", "🌐 allUsers")}
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
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No buckets found.</td></tr>
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
        {selected && <BucketDrawerContent bucket={selected} />}
      </DetailDrawer>
    </>
  );
}

function BucketDrawerContent({ bucket }: { bucket: StorageBucket }) {
  const pub = isPublic(bucket);
  return (
    <>
      <DrawerSection label="Bucket Details">
        <DrawerField label="Name" value={bucket.name} mono />
        <DrawerField label="Project" value={bucket.projectId} mono />
        <DrawerField label="Location" value={bucket.location} mono />
        <DrawerField label="Storage Class" value={
          <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", CLASS_COLORS[bucket.storageClass] ?? CLASS_COLORS.STANDARD)}>
            {bucket.storageClass}
          </span>
        } />
        <DrawerField label="Public Access" value={
          pub ? (
            <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
              <AlertTriangle className="w-3 h-3" /> Publicly accessible
            </span>
          ) : (
            <span className="text-xs text-emerald-400">Private</span>
          )
        } />
      </DrawerSection>

      {pub && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">Public Access Warning</p>
              <p className="text-xs text-red-300/70 mt-1">
                This bucket grants access to <span className="font-mono">allUsers</span> or <span className="font-mono">allAuthenticatedUsers</span>. Data may be publicly readable or writable.
              </p>
            </div>
          </div>
        </div>
      )}

      <DrawerSection label={`IAM Bindings (${bucket.iamPolicy.bindings.length})`}>
        {bucket.iamPolicy.bindings.length === 0 ? (
          <p className="text-xs text-slate-500">No IAM bindings found.</p>
        ) : (
          <div className="space-y-4">
            {bucket.iamPolicy.bindings.map((binding) => (
              <div key={binding.role} className="space-y-1.5">
                <p className="text-xs font-mono text-sky-400">{binding.role.replace("roles/", "")}</p>
                <div className="flex flex-wrap gap-1 pl-2">
                  {binding.members.map((m) => (
                    <span key={m} className={cn(
                      "px-2 py-0.5 rounded text-xs font-mono border",
                      m === "allUsers" || m === "allAuthenticatedUsers"
                        ? "bg-red-900/40 text-red-300 border-red-700/50"
                        : "bg-slate-800 border-slate-700/50 text-slate-300"
                    )}>
                      {m.replace("user:", "").replace("serviceAccount:", "SA: ").replace("allUsers", "🌐 allUsers").replace("allAuthenticatedUsers", "🌐 allAuthenticatedUsers")}
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
