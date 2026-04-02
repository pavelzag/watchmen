"use client";

import { useEffect, useState, useRef, useCallback, forwardRef } from "react";
import {
  Users, HardDrive, Server, KeySquare, MonitorDot, ChevronRight,
  Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot } from "@/lib/gcp/types";
import ScanProgress from "@/components/ScanProgress";
import CopyTextButton from "@/components/CopyTextButton";

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
  _snap?: GcpSnapshot;
}

interface SnapshotStatsProps {
  scanVersion?: number;
  onSyncRequest?: () => void;
  isSyncing?: boolean;
  overrideSnapshot?: object | null;
}

export default function SnapshotStats({ scanVersion, onSyncRequest, isSyncing, overrideSnapshot }: SnapshotStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState<string>("");
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const tileRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const router = useRouter();

  async function fetchStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/snapshot");
      if (res.status === 404) { setStats(null); return; }
      if (!res.ok) throw new Error("Failed to load GCP data");
      const data = await res.json();
      setStats({ ...data, _snap: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (overrideSnapshot != null) {
      setStats({ ...(overrideSnapshot as Stats), _snap: overrideSnapshot as GcpSnapshot });
      setLoading(false);
      setError(null);
      return;
    }
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanVersion, overrideSnapshot]);

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

  const buildTiles = useCallback((s: Stats) => [
    { icon: Users, label: "USERS", value: s.users.length, href: "/dashboard/users" },
    { icon: KeySquare, label: "SVC ACCTS", value: s.serviceAccountEmails.length, href: "/dashboard/service-accounts" },
    { icon: HardDrive, label: "BUCKETS", value: s.storageBuckets.length, href: "/dashboard/buckets" },
    { icon: Server, label: "GKE", value: s.gkeClusters.length, href: "/dashboard/clusters" },
    { icon: MonitorDot, label: "VMs", value: s.vms.length, href: "/dashboard/vms" },
    { icon: Play, label: "CLOUD RUN", value: s.cloudRunServices.length, href: "/dashboard/cloud-run" },
    { icon: Database, label: "CLOUD SQL", value: s.cloudSqlInstances.length, href: "/dashboard/cloud-sql" },
    { icon: BarChart3, label: "BIGQUERY", value: s.bigqueryDatasets.length, href: "/dashboard/bigquery" },
    { icon: Radio, label: "PUB/SUB", value: s.pubsubTopics.length, href: "/dashboard/pubsub" },
    { icon: Lock, label: "SECRETS", value: s.secrets.length, href: "/dashboard/secrets" },
    { icon: Flame, label: "FIREWALL", value: s.firewallRules.length, href: "/dashboard/firewall" },
  ], []);

  const allTiles = stats ? buildTiles(stats) : [];

  const findings = stats?._snap ? computeFindings(stats._snap) : [];
  const scanWarnings = stats?._snap?.scanWarnings ?? [];
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const accessRelatedWarnings = scanWarnings.filter((warning) =>
    warning.code === "permission_denied" || warning.code === "unauthenticated"
  );
  const transientWarnings = scanWarnings.filter((warning) =>
    warning.code === "timeout" || warning.code === "rate_limited" || warning.code === "transient_network"
  );

  function handleGridKey(e: React.KeyboardEvent) {
    if (allTiles.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = focusedIdx < allTiles.length - 1 ? focusedIdx + 1 : 0;
      setFocusedIdx(next);
      tileRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = focusedIdx > 0 ? focusedIdx - 1 : allTiles.length - 1;
      setFocusedIdx(next);
      tileRefs.current[next]?.focus();
    } else if (e.key === "Enter" && focusedIdx >= 0) {
      router.push(allTiles[focusedIdx].href);
    } else if (e.key === "Escape") {
      setFocusedIdx(-1);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        {onSyncRequest && (
          <button
            onClick={onSyncRequest}
            disabled={isSyncing || loading}
            className="flex items-center gap-1 text-xs uppercase tracking-widest transition-colors px-2 py-1"
            style={{
              border: "1px solid #005c16",
              color: isSyncing ? "#ffaa00" : "#00aa2b",
              background: "transparent",
            }}
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "[SYNCING...]" : "[SYNC GCP]"}
          </button>
        )}
      </div>

      {error && (
        <div
          className="px-3 py-2 text-xs"
          style={{ border: "1px solid #ff3333", background: "#1a0000", color: "#ff3333" }}
        >
          !! ERROR: {error}
        </div>
      )}

      <ScanProgress isScanning={!!isSyncing} />

      {/* Loading skeleton */}
      {(loading || isSyncing) && !stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="p-3 animate-pulse space-y-2"
              style={{ border: "1px solid #003010", background: "#0a0a0a" }}
            >
              <div className="h-2 w-12" style={{ background: "#003010" }} />
              <div className="h-5 w-8" style={{ background: "#003010" }} />
            </div>
          ))}
        </div>
      )}

      {!loading && !isSyncing && !stats && !error && (
        <div className="px-3 py-2 text-xs" style={{ border: "1px solid #003010", color: "#005c16" }}>
          // Scan pending — GCP data will appear shortly
        </div>
      )}

      {stats && (
        <>
          {scanWarnings.length > 0 && (
            <div
              className="px-3 py-3 space-y-2 text-xs"
              style={{ border: "1px solid #665500", background: "#0f0c00", color: "#f5d76e" }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>// PARTIAL SCAN COVERAGE</span>
                  {accessRelatedWarnings.length > 0 && (
                    <span style={{ border: "1px solid #f5d76e55", padding: "2px 6px" }}>
                      {accessRelatedWarnings.length} access-related
                    </span>
                  )}
                  {transientWarnings.length > 0 && (
                    <span style={{ border: "1px solid #f5d76e55", padding: "2px 6px" }}>
                      {transientWarnings.length} temporary
                    </span>
                  )}
                </div>
                <span style={{ color: "#bfa94d" }}>
                  {scanWarnings.length} warning{scanWarnings.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-1">
                {scanWarnings.slice(0, 5).map((warning, index) => (
                  <div key={`${warning.service}-${warning.projectId}-${index}`} className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <span style={{ color: "#f5d76e" }}>{warning.message}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span style={{ color: "#8a7a39", whiteSpace: "nowrap" }}>
                        [{warning.service}]
                      </span>
                      <CopyTextButton
                        text={[warning.message, warning.detail].filter(Boolean).join("\n\n")}
                        label="Copy"
                        className="flex items-center gap-1 text-[10px] font-mono"
                        style={{ color: "#f5d76e" }}
                      />
                    </div>
                  </div>
                ))}
                {scanWarnings.length > 5 && (
                  <p style={{ color: "#8a7a39" }}>
                    …and {scanWarnings.length - 5} more project/service warning{scanWarnings.length - 5 === 1 ? "" : "s"}.
                  </p>
                )}
              </div>
              <div className="pt-1">
                <Link
                  href="/dashboard/scan-coverage"
                  className="inline-flex items-center gap-1 uppercase tracking-widest"
                  style={{ color: "#f5d76e" }}
                >
                  [VIEW FULL SCAN COVERAGE]
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Findings alert */}
          {findings.length > 0 && (
            <Link
              href="/dashboard/findings"
              className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest transition-all"
              style={{ border: "1px solid #440000", background: "#0a0000" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#ff3333";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#440000";
              }}
            >
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" style={{ color: "#ff3333" }} />
                <span style={{ color: "#ff3333" }}>!! SECURITY FINDINGS</span>
                {criticalCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 text-xs font-bold"
                    style={{ background: "#ff3333", color: "#090909" }}
                  >
                    {criticalCount} CRITICAL
                  </span>
                )}
                {highCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 text-xs"
                    style={{ border: "1px solid #ff3333", color: "#ff3333" }}
                  >
                    {highCount} HIGH
                  </span>
                )}
              </div>
              <ChevronRight className="w-3 h-3" style={{ color: "#ff3333" }} />
            </Link>
          )}

          {/* Keyboard nav hint */}
          <p className="text-xs" style={{ color: "#003010" }}>
            // ↑↓ navigate tiles · Enter to open · updated {age}
          </p>

          {/* Tile grid with keyboard nav */}
          <div
            onKeyDown={handleGridKey}
          // Allow the container to receive focus events from children
          >
            <div className="grid grid-cols-5 gap-2">
              {allTiles.map((tile, i) => (
                <StatTile
                  key={tile.label}
                  {...tile}
                  isFocused={focusedIdx === i}
                  ref={(el) => { tileRefs.current[i] = el; }}
                  onFocus={() => setFocusedIdx(i)}
                />
              ))}
            </div>
          </div>

          <p className="text-xs" style={{ color: "#003010" }}>
            // fetched {new Date(stats.fetchedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}


const StatTile = forwardRef<
  HTMLAnchorElement,
  { icon: React.ElementType; label: string; value: number; href: string; isFocused?: boolean; onFocus?: () => void }
>(function StatTile({ icon: Icon, label, value, href, isFocused, onFocus }, ref) {
  return (
    <Link
      href={href}
      ref={ref}
      onFocus={onFocus}
      data-nav
      tabIndex={0}
      className="terminal-card-link group p-3 block outline-none"
      style={isFocused ? { borderColor: "#00ff41", boxShadow: "0 0 10px #00ff4155" } : undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3 h-3" style={{ color: "#00aa2b" }} />
          <span className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
            {label}
          </span>
        </div>
        <ChevronRight
          className="w-3 h-3 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity"
          style={{ color: "#00ff41" }}
        />
      </div>
      <p
        className="text-2xl font-bold tabular-nums"
        style={{ color: "#00ff41", textShadow: isFocused ? "0 0 12px #00ff41" : "0 0 8px #00ff4133" }}
      >
        {value}
      </p>
    </Link>
  );
});
