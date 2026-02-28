"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, GitCompare, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSnapshots, diffSnapshots, type StoredSnapshot, type SnapshotDiff } from "@/lib/snapshot-history";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function DiffRow({ label, added, removed }: { label: string; added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      {added.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {added.map((item) => (
            <span key={item} className="px-1.5 py-0.5 rounded text-xs font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              + {item}
            </span>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {removed.map((item) => (
            <span key={item} className="px-1.5 py-0.5 rounded text-xs font-mono bg-red-500/10 border border-red-500/30 text-red-400">
              − {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: SnapshotDiff }) {
  const sections = [
    { label: "Projects", added: diff.added.projects, removed: diff.removed.projects },
    { label: "Service Accounts", added: diff.added.serviceAccounts, removed: diff.removed.serviceAccounts },
    { label: "Storage Buckets", added: diff.added.storageBuckets, removed: diff.removed.storageBuckets },
    { label: "GKE Clusters", added: diff.added.gkeClusters, removed: diff.removed.gkeClusters },
    { label: "VMs", added: diff.added.vms, removed: diff.removed.vms },
    { label: "Cloud Run Services", added: diff.added.cloudRunServices, removed: diff.removed.cloudRunServices },
    { label: "Cloud SQL Instances", added: diff.added.cloudSqlInstances, removed: diff.removed.cloudSqlInstances },
    { label: "Pub/Sub Topics", added: diff.added.pubsubTopics, removed: diff.removed.pubsubTopics },
    { label: "Secrets", added: diff.added.secrets, removed: diff.removed.secrets },
    { label: "Firewall Rules", added: diff.added.firewallRules, removed: diff.removed.firewallRules },
  ].filter((s) => s.added.length > 0 || s.removed.length > 0);

  if (sections.length === 0) {
    return (
      <div className="py-6 text-center text-slate-500 text-sm">
        No resource changes detected between these two snapshots.
      </div>
    );
  }

  const totalAdded = sections.reduce((n, s) => n + s.added.length, 0);
  const totalRemoved = sections.reduce((n, s) => n + s.removed.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
          +{totalAdded} added
        </span>
        <span className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
          −{totalRemoved} removed
        </span>
      </div>
      <div className="space-y-3">
        {sections.map((s) => (
          <DiffRow key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setSnapshots(getSnapshots());
  }, []);

  function handleCompare(idxA: number, idxB: number) {
    const a = snapshots[idxA];
    const b = snapshots[idxB];
    if (!a || !b) return;
    // Compare older (b) to newer (a)
    const older = new Date(a.fetchedAt) < new Date(b.fetchedAt) ? a : b;
    const newer = a === older ? b : a;
    setSelected([idxA, idxB]);
    setDiff(diffSnapshots(older.data, newer.data));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <Clock className="w-5 h-5 text-slate-400" />
        <h1 className="text-lg font-semibold text-white">Snapshot History</h1>
        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
          {snapshots.length} stored
        </span>
      </div>

      <p className="text-sm text-slate-400">
        GCP snapshots are automatically saved when you visit the dashboard. Select two to compare.
        Up to 10 snapshots are kept in your browser&apos;s local storage.
      </p>

      {snapshots.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No snapshots saved yet.</p>
          <p className="text-xs mt-1">Visit the dashboard to auto-save the first snapshot.</p>
        </div>
      )}

      {/* Snapshot list */}
      {snapshots.length > 0 && (
        <div className="space-y-2">
          {snapshots.map((snap, idx) => {
            const isSelected = selected && (selected[0] === idx || selected[1] === idx);
            const isExpanded = expanded === idx;
            return (
              <div
                key={snap.snapshotId}
                className={cn(
                  "glass rounded-xl border transition-all duration-150",
                  isSelected ? "border-sky-500/40" : "border-slate-700/30"
                )}
              >
                <div
                  className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : idx)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-mono">{fmt(snap.fetchedAt)}</p>
                      <p className="text-xs text-slate-500 truncate">{snap.snapshotId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">
                      {snap.data.projects.length}p / {snap.data.serviceAccounts.length}sa / {snap.data.storageBuckets.length}b
                    </span>
                    {idx < snapshots.length - 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompare(idx, idx + 1);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 border border-slate-700/50 hover:border-sky-500/30 transition-all duration-150"
                      >
                        <GitCompare className="w-3 h-3" />
                        vs next
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-700/30">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-400">
                      <span>{snap.data.projects.length} projects</span>
                      <span>{snap.data.serviceAccounts.length} service accounts</span>
                      <span>{snap.data.storageBuckets.length} buckets</span>
                      <span>{snap.data.gkeClusters.length} clusters</span>
                      <span>{snap.data.vms.length} VMs</span>
                      <span>{snap.data.cloudRunServices.length} Cloud Run</span>
                      <span>{snap.data.cloudSqlInstances.length} Cloud SQL</span>
                      <span>{snap.data.pubsubTopics.length} topics</span>
                      <span>{snap.data.secrets.length} secrets</span>
                      <span>{snap.data.firewallRules.length} firewall rules</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Diff panel */}
      {diff && selected && (
        <div className="glass rounded-xl border border-sky-500/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-white">Snapshot Diff</h2>
            <span className="text-xs text-slate-500">
              {fmt(snapshots[Math.max(...selected)].fetchedAt)} → {fmt(snapshots[Math.min(...selected)].fetchedAt)}
            </span>
          </div>
          <DiffView diff={diff} />
        </div>
      )}
    </div>
  );
}
