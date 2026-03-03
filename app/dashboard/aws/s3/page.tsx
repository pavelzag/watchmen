"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsS3Bucket, AwsIamStatement } from "@/lib/aws/types";

const ENCRYPTION_COLORS: Record<string, string> = {
  "SSE-S3": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "SSE-KMS": "text-sky-400 bg-sky-500/10 border-sky-500/20",
  "DSSE-KMS": "text-violet-400 bg-violet-500/10 border-violet-500/20",
  None: "text-red-400 bg-red-500/10 border-red-500/20",
};

function isPublicBucket(bucket: AwsS3Bucket): boolean {
  const pab = bucket.publicAccessBlock;
  if (!pab.blockPublicAcls || !pab.ignorePublicAcls || !pab.blockPublicPolicy || !pab.restrictPublicBuckets) {
    return true;
  }
  return bucket.bucketPolicy.some((s) => s.effect === "Allow" && s.principals.includes("*"));
}

function hasPolicyPublic(bucket: AwsS3Bucket): boolean {
  return bucket.bucketPolicy.some((s) => s.effect === "Allow" && s.principals.includes("*"));
}

export default function S3Page() {
  const [buckets, setBuckets] = useState<AwsS3Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsS3Bucket | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setBuckets(snap.s3Buckets ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(buckets.map((b) => b.accountId))].sort();

  const filtered = buckets.filter(
    (b) =>
      (!accountFilter || b.accountId === accountFilter) &&
      (b.bucketName.toLowerCase().includes(search.toLowerCase()) ||
        b.accountId.toLowerCase().includes(search.toLowerCase()) ||
        b.region.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="S3 Buckets"
          count={loading ? null : filtered.length}
          search={search}
          onSearch={setSearch}
          projects={accountOptions}
          projectFilter={accountFilter}
          onProjectFilter={setAccountFilter}
        />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Bucket</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Public Access</th>
                <th className="px-4 py-3 text-left">Versioning</th>
                <th className="px-4 py-3 text-left">Encryption</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-t border-slate-700/30">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                filtered.map((bucket) => {
                  const pub = isPublicBucket(bucket);
                  const publicPolicy = hasPolicyPublic(bucket);
                  return (
                    <tr
                      key={bucket.bucketName}
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(bucket)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(bucket)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.bucketName === bucket.bucketName && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{bucket.bucketName}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                          {bucket.accountId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{bucket.region}</td>
                      <td className="px-4 py-3">
                        {pub ? (
                          <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            {publicPolicy ? "PUBLIC (policy)" : "PUBLIC"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Private</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            bucket.versioning === "Enabled"
                              ? "text-emerald-400 bg-emerald-500/10"
                              : "text-slate-400 bg-slate-700/40"
                          )}
                        >
                          {bucket.versioning}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-medium border",
                            ENCRYPTION_COLORS[bucket.encryption] ?? ENCRYPTION_COLORS.None
                          )}
                        >
                          {bucket.encryption}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No S3 buckets found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.bucketName ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && <S3DrawerContent bucket={selected} />}
      </DetailDrawer>
    </>
  );
}

function PolicyStatementBlock({ stmt }: { stmt: AwsIamStatement }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-1.5">
      <span
        className={cn(
          "inline-block px-1.5 py-0.5 rounded text-xs font-medium",
          stmt.effect === "Allow"
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            : "bg-red-500/10 text-red-400 border border-red-500/20"
        )}
      >
        {stmt.effect}
      </span>
      <div className="flex flex-wrap gap-1">
        {stmt.principals.map((p) => (
          <span
            key={p}
            className={cn(
              "px-1.5 py-0.5 rounded text-xs font-mono",
              p === "*" ? "bg-red-900/40 text-red-300 border border-red-700/50" : "bg-slate-700 text-slate-300"
            )}
          >
            {p}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {stmt.actions.map((a) => (
          <span key={a} className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700 text-sky-300">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

function S3DrawerContent({ bucket }: { bucket: AwsS3Bucket }) {
  const pub = isPublicBucket(bucket);
  const pab = bucket.publicAccessBlock;
  return (
    <>
      <DrawerSection label="Bucket Details">
        <DrawerField label="Name" value={bucket.bucketName} mono />
        <DrawerField label="Account" value={bucket.accountId} mono />
        <DrawerField label="Region" value={bucket.region} />
        <DrawerField label="Created" value={new Date(bucket.creationDate).toLocaleString()} />
        <DrawerField label="ACL" value={bucket.acl} mono />
        <DrawerField
          label="Encryption"
          value={
            <span
              className={cn(
                "px-2 py-0.5 rounded-md text-xs font-medium border",
                ENCRYPTION_COLORS[bucket.encryption] ?? ENCRYPTION_COLORS.None
              )}
            >
              {bucket.encryption}
            </span>
          }
        />
        <DrawerField
          label="Versioning"
          value={
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium",
                bucket.versioning === "Enabled"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-slate-400 bg-slate-700/40"
              )}
            >
              {bucket.versioning}
            </span>
          }
        />
      </DrawerSection>

      <DrawerSection label="Public Access Block">
        <DrawerField
          label="Block Public ACLs"
          value={
            <span className={pab.blockPublicAcls ? "text-emerald-400" : "text-red-400"}>
              {pab.blockPublicAcls ? "Enabled" : "Disabled"}
            </span>
          }
        />
        <DrawerField
          label="Ignore Public ACLs"
          value={
            <span className={pab.ignorePublicAcls ? "text-emerald-400" : "text-red-400"}>
              {pab.ignorePublicAcls ? "Enabled" : "Disabled"}
            </span>
          }
        />
        <DrawerField
          label="Block Public Policy"
          value={
            <span className={pab.blockPublicPolicy ? "text-emerald-400" : "text-red-400"}>
              {pab.blockPublicPolicy ? "Enabled" : "Disabled"}
            </span>
          }
        />
        <DrawerField
          label="Restrict Public Buckets"
          value={
            <span className={pab.restrictPublicBuckets ? "text-emerald-400" : "text-red-400"}>
              {pab.restrictPublicBuckets ? "Enabled" : "Disabled"}
            </span>
          }
        />
      </DrawerSection>

      {pub && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">Public Access Warning</p>
              <p className="text-xs text-red-300/70 mt-1">
                This bucket may be publicly accessible. Enable all public access block settings and review
                bucket policies.
              </p>
            </div>
          </div>
        </div>
      )}

      <DrawerSection label={`Bucket Policy (${bucket.bucketPolicy.length} statements)`}>
        {bucket.bucketPolicy.length === 0 ? (
          <p className="text-xs text-slate-500">No bucket policy.</p>
        ) : (
          <div className="space-y-2">
            {bucket.bucketPolicy.map((stmt, i) => (
              <PolicyStatementBlock key={i} stmt={stmt} />
            ))}
          </div>
        )}
      </DrawerSection>

      {Object.keys(bucket.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(bucket.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
