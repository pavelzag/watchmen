"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, Loader2, User, KeySquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GcpSnapshot, IamBinding } from "@/lib/gcp/types";

interface PrincipalAccess {
  projectAccess: { projectId: string; projectName: string; roles: string[] }[];
  bucketAccess: { bucket: string; project: string; roles: string[] }[];
  clusterAccess: { cluster: string; project: string; location: string; roles: string[] }[];
  cloudRunAccess: { service: string; project: string; region: string; roles: string[] }[];
  bigqueryAccess: { dataset: string; project: string; roles: string[] }[];
  secretAccess: { secret: string; project: string; roles: string[] }[];
  serviceAccountInfo?: { email: string; displayName: string; projectId: string; disabled: boolean; roles: string[] } | null;
}

function bindingRolesFor(bindings: IamBinding[], tags: string[]): string[] {
  return bindings.filter((b) => b.members.some((m) => tags.includes(m))).map((b) => b.role);
}

function computePrincipalAccess(email: string, snap: GcpSnapshot): PrincipalAccess {
  const userTag = `user:${email}`;
  const saTag = `serviceAccount:${email}`;
  const tags = [userTag, saTag];

  const projectAccess = snap.projects
    .map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      roles: bindingRolesFor(p.bindings, tags),
    }))
    .filter((p) => p.roles.length > 0);

  const bucketAccess = snap.storageBuckets
    .map((b) => ({
      bucket: b.name,
      project: b.projectId,
      roles: bindingRolesFor(b.iamPolicy.bindings, tags),
    }))
    .filter((b) => b.roles.length > 0);

  const clusterAccess = snap.gkeClusters
    .map((c) => ({
      cluster: c.name,
      project: c.projectId,
      location: c.location,
      roles: bindingRolesFor(c.iamPolicy.bindings, tags),
    }))
    .filter((c) => c.roles.length > 0);

  const cloudRunAccess = snap.cloudRunServices
    .map((s) => ({
      service: s.name,
      project: s.projectId,
      region: s.region,
      roles: bindingRolesFor(s.iamPolicy.bindings, tags),
    }))
    .filter((s) => s.roles.length > 0);

  const bigqueryAccess = snap.bigqueryDatasets
    .map((d) => ({
      dataset: d.datasetId,
      project: d.projectId,
      roles: bindingRolesFor(d.iamPolicy.bindings, tags),
    }))
    .filter((d) => d.roles.length > 0);

  const secretAccess = snap.secrets
    .map((s) => ({
      secret: s.name.split("/").pop() ?? s.name,
      project: s.projectId,
      roles: bindingRolesFor(s.iamPolicy.bindings, tags),
    }))
    .filter((s) => s.roles.length > 0);

  const saInfo = snap.serviceAccounts.find((sa) => sa.email === email);

  return {
    projectAccess,
    bucketAccess,
    clusterAccess,
    cloudRunAccess,
    bigqueryAccess,
    secretAccess,
    serviceAccountInfo: saInfo
      ? {
          email: saInfo.email,
          displayName: saInfo.displayName,
          projectId: saInfo.projectId,
          disabled: saInfo.disabled,
          roles: saInfo.roles,
        }
      : null,
  };
}

function AccessSection({
  title, items, renderRow,
}: {
  title: string;
  items: unknown[];
  renderRow: (item: unknown) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="glass rounded-lg p-3">
            {renderRow(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RolePills({ roles }: { roles: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {roles.map((r) => (
        <span key={r} className="px-1.5 py-0.5 rounded text-xs font-mono bg-sky-500/10 border border-sky-500/20 text-sky-400">
          {r.replace("roles/", "")}
        </span>
      ))}
    </div>
  );
}

export default function PrincipalPage() {
  const [email, setEmail] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrincipalAccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setEmail(trimmed);
    try {
      const res = await fetch("/api/gcp/snapshot");
      if (!res.ok) throw new Error("Failed to load GCP data");
      const snap: GcpSnapshot = await res.json();
      setResult(computePrincipalAccess(trimmed, snap));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  const hasAccess = result && (
    result.projectAccess.length > 0 ||
    result.bucketAccess.length > 0 ||
    result.clusterAccess.length > 0 ||
    result.cloudRunAccess.length > 0 ||
    result.bigqueryAccess.length > 0 ||
    result.secretAccess.length > 0 ||
    result.serviceAccountInfo
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-white">Principal Explorer</h1>
      </div>
      <p className="text-sm text-slate-400">
        Search any email address to see its unified access across all GCP resource types.
      </p>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="user@example.com or sa@project.iam.gserviceaccount.com"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500/50 focus:shadow-[0_0_0_1px_rgba(14,165,233,0.2)]"
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className={cn(
            "px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
            input.trim() && !loading
              ? "bg-sky-500 text-white hover:bg-sky-400"
              : "bg-slate-700 text-slate-500 cursor-not-allowed"
          )}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-400 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">{error}</p>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Identity card */}
          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", result.serviceAccountInfo ? "bg-amber-500/10" : "bg-violet-500/10")}>
              {result.serviceAccountInfo
                ? <KeySquare className="w-5 h-5 text-amber-400" />
                : <User className="w-5 h-5 text-violet-400" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-white font-mono">{email}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {result.serviceAccountInfo
                  ? `Service Account · ${result.serviceAccountInfo.projectId}${result.serviceAccountInfo.disabled ? " · Disabled" : ""}`
                  : "Human User"}
              </p>
            </div>
          </div>

          {/* Service Account identity */}
          {result.serviceAccountInfo && (
            <div className="glass rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Service Account Identity</p>
              <p className="text-xs text-slate-300">{result.serviceAccountInfo.displayName || "—"}</p>
              {result.serviceAccountInfo.roles.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Project roles:</p>
                  <RolePills roles={result.serviceAccountInfo.roles} />
                </div>
              )}
            </div>
          )}

          {!hasAccess && (
            <div className="text-center py-12 text-slate-500">
              <p className="text-sm">No access found for <span className="font-mono text-slate-400">{email}</span> across any resource.</p>
            </div>
          )}

          <AccessSection
            title={`Project Access (${result.projectAccess.length})`}
            items={result.projectAccess}
            renderRow={(item) => {
              const p = item as typeof result.projectAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{p.projectName}</span>
                    <span className="text-xs text-slate-500 font-mono">{p.projectId}</span>
                  </div>
                  <RolePills roles={p.roles} />
                </>
              );
            }}
          />

          <AccessSection
            title={`Storage Bucket Access (${result.bucketAccess.length})`}
            items={result.bucketAccess}
            renderRow={(item) => {
              const b = item as typeof result.bucketAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{b.bucket}</span>
                    <span className="text-xs text-slate-500 font-mono">{b.project}</span>
                  </div>
                  <RolePills roles={b.roles} />
                </>
              );
            }}
          />

          <AccessSection
            title={`GKE Cluster Access (${result.clusterAccess.length})`}
            items={result.clusterAccess}
            renderRow={(item) => {
              const c = item as typeof result.clusterAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{c.cluster}</span>
                    <span className="text-xs text-slate-500 font-mono">{c.project} / {c.location}</span>
                  </div>
                  <RolePills roles={c.roles} />
                </>
              );
            }}
          />

          <AccessSection
            title={`Cloud Run Access (${result.cloudRunAccess.length})`}
            items={result.cloudRunAccess}
            renderRow={(item) => {
              const s = item as typeof result.cloudRunAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{s.service}</span>
                    <span className="text-xs text-slate-500 font-mono">{s.project} / {s.region}</span>
                  </div>
                  <RolePills roles={s.roles} />
                </>
              );
            }}
          />

          <AccessSection
            title={`BigQuery Access (${result.bigqueryAccess.length})`}
            items={result.bigqueryAccess}
            renderRow={(item) => {
              const d = item as typeof result.bigqueryAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{d.dataset}</span>
                    <span className="text-xs text-slate-500 font-mono">{d.project}</span>
                  </div>
                  <RolePills roles={d.roles} />
                </>
              );
            }}
          />

          <AccessSection
            title={`Secret Access (${result.secretAccess.length})`}
            items={result.secretAccess}
            renderRow={(item) => {
              const s = item as typeof result.secretAccess[0];
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{s.secret}</span>
                    <span className="text-xs text-slate-500 font-mono">{s.project}</span>
                  </div>
                  <RolePills roles={s.roles} />
                </>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
