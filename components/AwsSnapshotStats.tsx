"use client";

import { useEffect, useState, useRef, useCallback, forwardRef } from "react";
import {
  Users, HardDrive, Server, KeySquare, MonitorDot, ChevronRight,
  Play, Database, BarChart3, Radio, Lock, Shield, ShieldAlert, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { computeAwsFindings } from "@/lib/aws-findings";
import type { AwsSnapshot } from "@/lib/aws/types";

interface AwsSnapshotStatsProps {
  scanVersion?: number;
  onSyncRequest?: () => void;
  isSyncing?: boolean;
  overrideSnapshot?: AwsSnapshot | null;
}

export default function AwsSnapshotStats({ scanVersion, onSyncRequest, isSyncing, overrideSnapshot }: AwsSnapshotStatsProps) {
  const [snap, setSnap] = useState<AwsSnapshot | null>(null);
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
      const res = await fetch("/api/aws/scan");
      if (res.status === 404) { setSnap(null); return; }
      if (!res.ok) throw new Error("Failed to load AWS data");
      const data = await res.json();
      if (data.snapshot) setSnap(data.snapshot as AwsSnapshot);
      else setSnap(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (overrideSnapshot != null) {
      setSnap(overrideSnapshot);
      setLoading(false);
      setError(null);
      return;
    }
    fetchStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanVersion, overrideSnapshot]);

  useEffect(() => {
    if (!snap) return;
    function updateAge() {
      const secs = Math.floor((Date.now() - new Date(snap!.fetchedAt).getTime()) / 1000);
      if (secs < 60) setAge(`${secs}s ago`);
      else setAge(`${Math.floor(secs / 60)}m ago`);
    }
    updateAge();
    const id = setInterval(updateAge, 10_000);
    return () => clearInterval(id);
  }, [snap]);

  const buildTiles = useCallback((s: AwsSnapshot) => [
    { icon: Users, label: "IAM USERS", value: s.iamUsers.length, href: "/dashboard/aws/iam-users" },
    { icon: KeySquare, label: "IAM ROLES", value: s.iamRoles.length, href: "/dashboard/aws/iam-roles" },
    { icon: HardDrive, label: "S3 BUCKETS", value: s.s3Buckets.length, href: "/dashboard/aws/s3" },
    { icon: Server, label: "EKS", value: s.eksClusters.length, href: "/dashboard/aws/eks" },
    { icon: MonitorDot, label: "EC2", value: s.ec2Instances.length, href: "/dashboard/aws/ec2" },
    { icon: Play, label: "LAMBDA", value: s.lambdaFunctions.length, href: "/dashboard/aws/lambda" },
    { icon: Database, label: "RDS", value: s.rdsInstances.length, href: "/dashboard/aws/rds" },
    { icon: BarChart3, label: "REDSHIFT", value: s.redshiftClusters.length, href: "/dashboard/aws/redshift" },
    { icon: Radio, label: "SNS", value: s.snsTopics.length, href: "/dashboard/aws/sns" },
    { icon: Lock, label: "SECRETS", value: s.secrets.length, href: "/dashboard/aws/secrets" },
    { icon: Shield, label: "SEC GROUPS", value: s.securityGroups.length, href: "/dashboard/aws/security-groups" },
  ], []);

  const allTiles = snap ? buildTiles(snap) : [];

  const findings = snap ? computeAwsFindings(snap) : [];
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

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
        <span className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
          // AWS SNAPSHOT
        </span>
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
            {isSyncing ? "[SYNCING...]" : "[SYNC AWS]"}
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

      {/* Loading skeleton */}
      {(loading || isSyncing) && !snap && (
        <div className="grid grid-cols-5 gap-2">
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

      {!loading && !isSyncing && !snap && !error && (
        <div className="px-3 py-2 text-xs" style={{ border: "1px solid #003010", color: "#005c16" }}>
          // Scan pending — AWS data will appear shortly
        </div>
      )}

      {snap && (
        <>
          {/* Findings alert */}
          {findings.length > 0 && (
            <Link
              href="/dashboard/aws/findings"
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
                <span style={{ color: "#ff3333" }}>!! AWS SECURITY FINDINGS</span>
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
          <div onKeyDown={handleGridKey}>
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
            // fetched {new Date(snap.fetchedAt).toLocaleString()}
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
