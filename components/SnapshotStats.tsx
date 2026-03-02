"use client";

import { useEffect, useState } from "react";
import {
  Users, HardDrive, Server, KeySquare, MonitorDot, ChevronRight,
  Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot } from "@/lib/gcp/types";
import ScanProgress from "@/components/ScanProgress";

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
          icon: Users, label: "Users", value: stats.users.length,
          sub: `${stats.projects.length} project(s)`,
          color: "text-violet-400",
          href: "/dashboard/users",
        },
        {
          icon: KeySquare, label: "Svc Accounts", value: stats.serviceAccountEmails.length,
          sub: `${stats.projects.length} project(s)`,
          color: "text-amber-400",
          href: "/dashboard/service-accounts",
        },
        {
          icon: HardDrive, label: "Buckets", value: stats.storageBuckets.length,
          sub: `${stats.storageBuckets.length} total`,
          color: "text-sky-400",
          href: "/dashboard/buckets",
        },
        {
          icon: Server, label: "GKE Clusters", value: stats.gkeClusters.length,
          sub: `${stats.gkeClusters.length} total`,
          color: "text-emerald-400",
          href: "/dashboard/clusters",
        },
        {
          icon: MonitorDot, label: "VMs", value: stats.vms.length,
          sub: `${stats.vms.filter((v) => v.status === "RUNNING").length} running`,
          color: "text-orange-400",
          href: "/dashboard/vms",
        },
      ]
    : [];

  const row2Tiles = stats
    ? [
        {
          icon: Play, label: "Cloud Run", value: stats.cloudRunServices.length,
          sub: `${stats.cloudRunServices.filter((s) => s.status === "ACTIVE").length} active`,
          color: "text-blue-400",
          href: "/dashboard/cloud-run",
        },
        {
          icon: Database, label: "Cloud SQL", value: stats.cloudSqlInstances.length,
          sub: `${stats.cloudSqlInstances.filter((i) => i.publicIp).length} public IP`,
          color: "text-teal-400",
          href: "/dashboard/cloud-sql",
        },
        {
          icon: BarChart3, label: "BigQuery", value: stats.bigqueryDatasets.length,
          sub: "datasets",
          color: "text-indigo-400",
          href: "/dashboard/bigquery",
        },
        {
          icon: Radio, label: "Pub/Sub", value: stats.pubsubTopics.length,
          sub: "topics",
          color: "text-pink-400",
          href: "/dashboard/pubsub",
        },
        {
          icon: Lock, label: "Secrets", value: stats.secrets.length,
          sub: "managed",
          color: "text-rose-400",
          href: "/dashboard/secrets",
        },
        {
          icon: Flame, label: "Firewall", value: stats.firewallRules.length,
          sub: `${stats.firewallRules.filter((r) => !r.disabled).length} active`,
          color: "text-yellow-400",
          href: "/dashboard/firewall",
        },
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-600 font-medium uppercase tracking-widest">
          GCP Snapshot
        </p>
        {onSyncRequest && (
          <button
            onClick={onSyncRequest}
            disabled={isSyncing || loading}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
            {isSyncing ? "Syncing…" : "Sync GCP"}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          {error}
        </p>
      )}

      <ScanProgress isScanning={!!isSyncing} />

      {(loading || isSyncing) && !stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="chrome-card rounded-xl p-3 animate-pulse space-y-2">
                <div className="h-3 w-16 bg-zinc-800 rounded" />
                <div className="h-6 w-8 bg-zinc-800 rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !isSyncing && !stats && !error && (
        <p className="text-xs text-zinc-500 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
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

          <p className="text-xs text-zinc-700 font-mono">
            Updated {age} · {new Date(stats.fetchedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon, label, value, sub, color, href,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub: string;
  color: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="chrome-card group rounded-xl p-3 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-800 cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className={cn("w-3.5 h-3.5", color)} />
        <ChevronRight className="w-3 h-3 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
      <p className="text-2xl font-bold font-mono text-white tabular-nums leading-none">{value}</p>
      <p className="text-xs text-zinc-500 mt-1.5 truncate uppercase tracking-wider">{label}</p>
      {sub && <p className="text-xs text-zinc-700 mt-0.5 truncate font-mono">{sub}</p>}
    </Link>
  );
}
