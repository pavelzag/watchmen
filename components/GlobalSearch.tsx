"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Server, HardDrive, KeySquare, MonitorDot, Play, Database, BarChart3, Radio, Lock, Flame, User, Shield, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GcpSnapshot } from "@/lib/gcp/types";
import type { AwsSnapshot } from "@/lib/aws/types";

// ── Resource index entry ──────────────────────────────────────────────────

interface ResourceEntry {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  cloud: "gcp" | "aws";
  href: string;
  keywords: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

// ── Build index from snapshots ────────────────────────────────────────────

function indexGcp(snap: GcpSnapshot): ResourceEntry[] {
  const entries: ResourceEntry[] = [];

  for (const sa of snap.serviceAccounts) {
    entries.push({
      id: `gcp:sa:${sa.email}`,
      name: sa.email,
      subtitle: sa.displayName || sa.projectId,
      type: "Service Account",
      cloud: "gcp",
      href: `/dashboard/service-accounts?search=${encodeURIComponent(sa.email)}`,
      keywords: `${sa.email} ${sa.displayName} ${sa.projectId}`,
      Icon: KeySquare,
    });
  }

  for (const b of snap.storageBuckets) {
    entries.push({
      id: `gcp:bucket:${b.name}`,
      name: b.name,
      subtitle: `${b.projectId} · ${b.location}`,
      type: "Storage Bucket",
      cloud: "gcp",
      href: `/dashboard/buckets?search=${encodeURIComponent(b.name)}`,
      keywords: `${b.name} ${b.projectId} ${b.location}`,
      Icon: HardDrive,
    });
  }

  for (const c of snap.gkeClusters) {
    entries.push({
      id: `gcp:cluster:${c.projectId}/${c.name}`,
      name: c.name,
      subtitle: `${c.projectId} · ${c.location}`,
      type: "GKE Cluster",
      cloud: "gcp",
      href: `/dashboard/clusters?search=${encodeURIComponent(c.name)}`,
      keywords: `${c.name} ${c.projectId} ${c.location}`,
      Icon: Server,
    });
  }

  for (const vm of snap.vms) {
    entries.push({
      id: `gcp:vm:${vm.projectId}/${vm.name}`,
      name: vm.name,
      subtitle: `${vm.projectId} · ${vm.zone}`,
      type: "VM",
      cloud: "gcp",
      href: `/dashboard/vms?search=${encodeURIComponent(vm.name)}`,
      keywords: `${vm.name} ${vm.projectId} ${vm.zone} ${vm.internalIp}`,
      Icon: MonitorDot,
    });
  }

  for (const cr of snap.cloudRunServices) {
    entries.push({
      id: `gcp:run:${cr.projectId}/${cr.name}`,
      name: cr.name,
      subtitle: cr.projectId,
      type: "Cloud Run",
      cloud: "gcp",
      href: `/dashboard/cloud-run?search=${encodeURIComponent(cr.name)}`,
      keywords: `${cr.name} ${cr.projectId}`,
      Icon: Play,
    });
  }

  for (const sql of snap.cloudSqlInstances) {
    entries.push({
      id: `gcp:sql:${sql.projectId}/${sql.name}`,
      name: sql.name,
      subtitle: `${sql.projectId} · ${sql.databaseVersion ?? ""}`,
      type: "Cloud SQL",
      cloud: "gcp",
      href: `/dashboard/cloud-sql?search=${encodeURIComponent(sql.name)}`,
      keywords: `${sql.name} ${sql.projectId}`,
      Icon: Database,
    });
  }

  for (const bq of snap.bigqueryDatasets) {
    entries.push({
      id: `gcp:bq:${bq.projectId}/${bq.datasetId}`,
      name: bq.datasetId,
      subtitle: `${bq.projectId} · ${bq.location}`,
      type: "BigQuery Dataset",
      cloud: "gcp",
      href: `/dashboard/bigquery?search=${encodeURIComponent(bq.datasetId)}`,
      keywords: `${bq.datasetId} ${bq.projectId} ${bq.location}`,
      Icon: BarChart3,
    });
  }

  for (const t of snap.pubsubTopics) {
    entries.push({
      id: `gcp:pubsub:${t.name}`,
      name: t.name,
      subtitle: t.projectId ?? "",
      type: "Pub/Sub Topic",
      cloud: "gcp",
      href: `/dashboard/pubsub?search=${encodeURIComponent(t.name)}`,
      keywords: `${t.name} ${t.projectId ?? ""}`,
      Icon: Radio,
    });
  }

  for (const s of snap.secrets) {
    entries.push({
      id: `gcp:secret:${s.name}`,
      name: s.name,
      subtitle: s.projectId ?? "",
      type: "Secret",
      cloud: "gcp",
      href: `/dashboard/secrets?search=${encodeURIComponent(s.name)}`,
      keywords: `${s.name} ${s.projectId ?? ""}`,
      Icon: Lock,
    });
  }

  for (const fw of snap.firewallRules) {
    entries.push({
      id: `gcp:fw:${fw.projectId}/${fw.name}`,
      name: fw.name,
      subtitle: fw.projectId,
      type: "Firewall Rule",
      cloud: "gcp",
      href: `/dashboard/firewall?search=${encodeURIComponent(fw.name)}`,
      keywords: `${fw.name} ${fw.projectId}`,
      Icon: Flame,
    });
  }

  return entries;
}

function indexAws(snap: AwsSnapshot): ResourceEntry[] {
  const entries: ResourceEntry[] = [];

  for (const u of snap.iamUsers) {
    entries.push({
      id: `aws:user:${u.arn}`,
      name: u.userName,
      subtitle: `${u.accountId} · ${u.arn}`,
      type: "IAM User",
      cloud: "aws",
      href: `/dashboard/aws/iam-users?search=${encodeURIComponent(u.userName)}`,
      keywords: `${u.userName} ${u.arn} ${u.accountId}`,
      Icon: User,
    });
  }

  for (const r of snap.iamRoles) {
    entries.push({
      id: `aws:role:${r.arn}`,
      name: r.roleName,
      subtitle: `${r.accountId} · ${r.arn}`,
      type: "IAM Role",
      cloud: "aws",
      href: `/dashboard/aws/iam-roles?search=${encodeURIComponent(r.roleName)}`,
      keywords: `${r.roleName} ${r.arn} ${r.accountId}`,
      Icon: KeySquare,
    });
  }

  for (const b of snap.s3Buckets) {
    entries.push({
      id: `aws:s3:${b.bucketName}`,
      name: b.bucketName,
      subtitle: `${b.accountId} · ${b.region}`,
      type: "S3 Bucket",
      cloud: "aws",
      href: `/dashboard/buckets?search=${encodeURIComponent(b.bucketName)}`,
      keywords: `${b.bucketName} ${b.accountId} ${b.region}`,
      Icon: HardDrive,
    });
  }

  for (const c of snap.eksClusters) {
    entries.push({
      id: `aws:eks:${c.arn}`,
      name: c.clusterName,
      subtitle: `${c.accountId} · ${c.region}`,
      type: "EKS Cluster",
      cloud: "aws",
      href: `/dashboard/aws/eks?search=${encodeURIComponent(c.clusterName)}`,
      keywords: `${c.clusterName} ${c.arn} ${c.accountId} ${c.region}`,
      Icon: Server,
    });
  }

  for (const i of snap.ec2Instances) {
    const nameTag = i.tags?.Name ?? "";
    entries.push({
      id: `aws:ec2:${i.instanceId}`,
      name: nameTag || i.instanceId,
      subtitle: `${i.instanceId} · ${i.region} · ${i.publicIpAddress ?? i.privateIpAddress}`,
      type: "EC2 Instance",
      cloud: "aws",
      href: `/dashboard/aws/ec2?search=${encodeURIComponent(nameTag || i.instanceId)}`,
      keywords: `${i.instanceId} ${nameTag} ${i.publicIpAddress ?? ""} ${i.privateIpAddress} ${i.region} ${i.accountId}`,
      Icon: MonitorDot,
    });
  }

  for (const fn of snap.lambdaFunctions) {
    entries.push({
      id: `aws:lambda:${fn.functionArn}`,
      name: fn.functionName,
      subtitle: `${fn.accountId} · ${fn.region}`,
      type: "Lambda",
      cloud: "aws",
      href: `/dashboard/aws/lambda?search=${encodeURIComponent(fn.functionName)}`,
      keywords: `${fn.functionName} ${fn.functionArn} ${fn.accountId} ${fn.region}`,
      Icon: Play,
    });
  }

  for (const db of snap.rdsInstances) {
    entries.push({
      id: `aws:rds:${db.dbInstanceArn}`,
      name: db.dbInstanceIdentifier,
      subtitle: `${db.accountId} · ${db.region} · ${db.dbEngine}`,
      type: "RDS Instance",
      cloud: "aws",
      href: `/dashboard/aws/rds?search=${encodeURIComponent(db.dbInstanceIdentifier)}`,
      keywords: `${db.dbInstanceIdentifier} ${db.dbInstanceArn} ${db.accountId} ${db.region}`,
      Icon: Database,
    });
  }

  for (const rs of snap.redshiftClusters) {
    entries.push({
      id: `aws:redshift:${rs.clusterIdentifier}`,
      name: rs.clusterIdentifier,
      subtitle: `${rs.accountId} · ${rs.region}`,
      type: "Redshift",
      cloud: "aws",
      href: `/dashboard/aws/redshift?search=${encodeURIComponent(rs.clusterIdentifier)}`,
      keywords: `${rs.clusterIdentifier} ${rs.accountId} ${rs.region}`,
      Icon: Database,
    });
  }

  for (const t of snap.snsTopics) {
    entries.push({
      id: `aws:sns:${t.topicArn}`,
      name: t.topicName,
      subtitle: `${t.accountId} · ${t.region}`,
      type: "SNS Topic",
      cloud: "aws",
      href: `/dashboard/aws/sns?search=${encodeURIComponent(t.topicName)}`,
      keywords: `${t.topicName} ${t.topicArn} ${t.accountId} ${t.region}`,
      Icon: Radio,
    });
  }

  for (const s of snap.secrets) {
    entries.push({
      id: `aws:secret:${s.arn}`,
      name: s.name,
      subtitle: `${s.accountId} · ${s.region}`,
      type: "AWS Secret",
      cloud: "aws",
      href: `/dashboard/aws/secrets?search=${encodeURIComponent(s.name)}`,
      keywords: `${s.name} ${s.arn} ${s.accountId} ${s.region}`,
      Icon: Lock,
    });
  }

  for (const sg of snap.securityGroups) {
    entries.push({
      id: `aws:sg:${sg.groupId}`,
      name: sg.groupName || sg.groupId,
      subtitle: `${sg.accountId} · ${sg.region} · ${sg.groupId}`,
      type: "Security Group",
      cloud: "aws",
      href: `/dashboard/aws/security-groups?search=${encodeURIComponent(sg.groupId)}`,
      keywords: `${sg.groupId} ${sg.groupName} ${sg.accountId} ${sg.region}`,
      Icon: Shield,
    });
  }

  return entries;
}

// ── Main component ────────────────────────────────────────────────────────

const MAX_RESULTS = 12;

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<ResourceEntry[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 40);
      if (loadState === "idle") loadIndex();
    }
  }, [open]);

  async function loadIndex() {
    setLoadState("loading");
    try {
      const [gcpResult, awsResult] = await Promise.allSettled([
        fetch("/api/gcp/snapshot").then((r) => r.ok ? r.json() : null),
        fetch("/api/aws/snapshot").then((r) => r.ok ? r.json() : null),
      ]);

      const entries: ResourceEntry[] = [];
      if (gcpResult.status === "fulfilled" && gcpResult.value) {
        entries.push(...indexGcp(gcpResult.value as GcpSnapshot));
      }
      if (awsResult.status === "fulfilled" && awsResult.value) {
        entries.push(...indexAws(awsResult.value as AwsSnapshot));
      }
      setIndex(entries);
      setLoadState("done");
    } catch {
      setLoadState("error");
    }
  }

  const results: ResourceEntry[] = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return index.slice(0, MAX_RESULTS);
    return index
      .filter((e) => e.keywords.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  })();

  function close() {
    setOpen(false);
    setQuery("");
  }

  function navigate(entry: ResourceEntry) {
    close();
    router.push(entry.href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && results[selectedIdx]) {
      navigate(results[selectedIdx]);
    }
  }

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center px-4 pt-20"
      style={{ background: "rgba(0,0,0,0.75)" }}
      data-command-palette-open="true"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="w-full max-w-xl overflow-hidden"
        style={{ background: "#090909", border: "1px solid #00ff41", boxShadow: "0 0 36px #00ff4122" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #005c16" }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: "#00aa2b" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search resources — service accounts, buckets, VMs, IPs…"
            className="flex-1 bg-transparent text-sm outline-none placeholder-slate-600"
            style={{ color: "#00ff41", fontFamily: "JetBrains Mono, monospace" }}
          />
          {loadState === "loading" && (
            <span className="text-[10px] uppercase tracking-widest animate-pulse shrink-0" style={{ color: "#005c16" }}>
              indexing…
            </span>
          )}
          <button onClick={close} className="shrink-0" style={{ color: "#005c16" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && loadState === "done" && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs font-mono" style={{ color: "#005c16" }}>
                {query ? `No resources matching "${query}"` : "No resources indexed yet"}
              </p>
            </div>
          )}
          {results.length === 0 && loadState === "loading" && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs font-mono animate-pulse" style={{ color: "#005c16" }}>
                Loading resource index…
              </p>
            </div>
          )}
          {results.map((entry, i) => {
            const Icon = entry.Icon;
            const isSelected = i === selectedIdx;
            return (
              <button
                key={entry.id}
                onClick={() => navigate(entry)}
                onMouseEnter={() => setSelectedIdx(i)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{
                  background: isSelected ? "#0a2010" : "transparent",
                  borderBottom: "1px solid #00ff4108",
                }}
              >
                <Icon
                  className="w-4 h-4 shrink-0"
                  style={{ color: isSelected ? "#00ff41" : "#005c16" }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-mono truncate font-medium"
                    style={{ color: isSelected ? "#00ff41" : "#a3a3a3" }}
                  >
                    {entry.name}
                  </p>
                  <p className="text-[10px] font-mono truncate" style={{ color: "#4b5563" }}>
                    {entry.subtitle}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span
                    className="text-[9px] uppercase tracking-widest px-1.5 py-0.5"
                    style={{
                      border: "1px solid #005c1640",
                      color: "#005c16",
                      fontFamily: "monospace",
                    }}
                  >
                    {entry.type}
                  </span>
                  <span
                    className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold"
                    style={{
                      border: `1px solid ${entry.cloud === "aws" ? "#f9731640" : "#0ea5e940"}`,
                      color: entry.cloud === "aws" ? "#f97316" : "#0ea5e9",
                      fontFamily: "monospace",
                    }}
                  >
                    {entry.cloud}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-2 text-[10px] font-mono"
          style={{ borderTop: "1px solid #003010", color: "#005c16" }}
        >
          <span>
            {loadState === "done" && `${index.length} resources indexed`}
            {loadState === "loading" && "Indexing…"}
          </span>
          <span>↑ ↓ navigate · ↵ open · Esc close</span>
        </div>
      </div>
    </div>
  );
}
