"use client";

import { useEffect, useState } from "react";
import {
  Users, HardDrive, Server, KeySquare, RefreshCw, MonitorDot, ChevronRight,
  Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot } from "@/lib/gcp/types";

interface Stats {
  users: string[];
  serviceAccountEmails: string[];
  storageBuckets: { name: string; projectId: string }[];
  gkeClusters: { name: string; projectId: string; location: string }[];
  vms: { name: string; projectId: string; status: string }[];
  projects: { projectId: string; projectName: string }[];
  cloudRunServices: { name: string; projectId: string; status: string }[];
  cloudSqlInstances: { name: string; projectId: string; publicIp?: string | null }[];
  bigqueryDatasets: { datasetId: string; projectId: string }[];
  pubsubTopics: { name: string; projectId: string }[];
  secrets: { name: string; projectId: string }[];
  firewallRules: { name: string; projectId: string; disabled: boolean }[];
  fetchedAt: string;
  // full snapshot for findings
  _snap?: GcpSnapshot;
}

interface SnapshotStatsProps {
  scanVersion?: number;
  onSyncRequest?: () => void;
  isSyncing?: boolean;
}

export default function SnapshotStats({ scanVersion, onSyncRequest, isSyncing }: SnapshotStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState<string>("");

  async function fetchStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/snapshot");
      if (res.status === 404) {
        // No snapshot yet — scan is pending
        setStats(null);
        return;
      }
      if (!res.ok) throw new Error("Failed to load GCP data");
      const data = await res.json();
      setStats({ ...data, _snap: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch when scanVersion bumps (scan completed) or on mount
  useEffect(() => { fetchStats(); }, [scanVersion]);

  // Live "updated X ago" counter
  useEffect(() => {
    if (!stats) return;
    function updateAge() {
      const secs = Math.floor((Date.now() - new Date(stats!.fetchedAt).getTime()) / 1000);
      if (secs < 60) setAge(`${secs}s ago`);
      else setAge(`${Math.floor(secs / 60)}m ago`);
    }
    updateAge();
    const id = setInterval(updateAge, 10_000);
    return () => clearInterval(id);
  }, [stats]);

  const findings = stats?._snap ? computeFindings(stats._snap) : [];
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  const row1Tiles = stats
    ? [
        {
          icon: Users, label: "Human Users", value: stats.users.length,
          sub: `across ${stats.projects.length} project(s)`,
          color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20",
          href: "/dashboard/users",
        },
        {
          icon: KeySquare, label: "Service Accounts", value: stats.serviceAccountEmails.length,
          sub: `across ${stats.projects.length} project(s)`,
          color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20",
          href: "/dashboard/service-accounts",
        },
        {
          icon: HardDrive, label: "Storage Buckets", value: stats.storageBuckets.length,
          sub: stats.storageBuckets.slice(0, 2).map((b) => b.name).join(", ") + (stats.storageBuckets.length > 2 ? "…" : ""),
          color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/20",
          href: "/dashboard/buckets",
        },
        {
          icon: Server, label: "GKE Clusters", value: stats.gkeClusters.length,
          sub: stats.gkeClusters.slice(0, 2).map((c) => c.name).join(", ") + (stats.gkeClusters.length > 2 ? "…" : ""),
          color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20",
          href: "/dashboard/clusters",
        },
        {
          icon: MonitorDot, label: "VMs", value: stats.vms.length,
          sub: `${stats.vms.filter((v) => v.status === "RUNNING").length} running`,
          color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20",
          href: "/dashboard/vms",
        },
      ]
    : [];

  const row2Tiles = stats
    ? [
        {
          icon: Play, label: "Cloud Run", value: stats.cloudRunServices.length,
          sub: `${stats.cloudRunServices.filter((s) => s.status === "ACTIVE").length} active`,
          color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20",
          href: "/dashboard/cloud-run",
        },
        {
          icon: Database, label: "Cloud SQL", value: stats.cloudSqlInstances.length,
          sub: `${stats.cloudSqlInstances.filter((i) => i.publicIp).length} with public IP`,
          color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20",
          href: "/dashboard/cloud-sql",
        },
        {
          icon: BarChart3, label: "BigQuery", value: stats.bigqueryDatasets.length,
          sub: "datasets",
          color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20",
          href: "/dashboard/bigquery",
        },
        {
          icon: Radio, label: "Pub/Sub", value: stats.pubsubTopics.length,
          sub: "topics",
          color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20",
          href: "/dashboard/pubsub",
        },
        {
          icon: Lock, label: "Secrets", value: stats.secrets.length,
          sub: "managed secrets",
          color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20",
          href: "/dashboard/secrets",
        },
        {
          icon: Flame, label: "Firewall Rules", value: stats.firewallRules.length,
          sub: `${stats.firewallRules.filter((r) => !r.disabled).length} active`,
          color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20",
          href: "/dashboard/firewall",
        },
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          GCP Snapshot
        </p>
        <div className="flex items-center gap-3">
          {/* Internal refresh — re-reads DB without triggering a new scan */}
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
          {/* Sync — triggers a new GCP scan */}
          {onSyncRequest && (
            <button
              onClick={onSyncRequest}
              disabled={isSyncing || loading}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-400 transition-colors"
            >
              <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
              {isSyncing ? "Syncing…" : "Sync GCP"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          {error}
        </p>
      )}

      {(loading || isSyncing) && !stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="glass rounded-xl p-3 animate-pulse space-y-2">
                <div className="h-3 w-16 bg-slate-700 rounded" />
                <div className="h-6 w-8 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !isSyncing && !stats && !error && (
        <p className="text-xs text-slate-500 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700">
          Scan in progress — GCP data will appear shortly.
        </p>
      )}

      {stats && (
        <>
          {/* Findings summary tile */}
          {findings.length > 0 && (
            <Link
              href="/dashboard/findings"
              className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-all duration-150 group"
            >
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-300">Security Findings</span>
                {criticalCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">
                    {criticalCount} critical
                  </span>
                )}
                {highCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 border border-orange-500/30 text-orange-400">
                    {highCount} high
                  </span>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          )}

          {/* Row 1 — core resources */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {row1Tiles.map((tile) => (
              <StatTile key={tile.label} {...tile} />
            ))}
          </div>

          {/* Row 2 — new resource types */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {row2Tiles.map((tile) => (
              <StatTile key={tile.label} {...tile} />
            ))}
          </div>

          <p className="text-xs text-slate-600">
            Updated {age} · {new Date(stats.fetchedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon, label, value, sub, color, bg, href,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub: string;
  color: string;
  bg: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-xl p-3 border transition-all duration-150",
        "hover:scale-[1.02] hover:shadow-lg cursor-pointer",
        bg
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("w-3.5 h-3.5", color)} />
          <span className="text-xs text-slate-400 truncate">{label}</span>
        </div>
        <ChevronRight className={cn("w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0", color)} />
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>
    </Link>
  );
}
