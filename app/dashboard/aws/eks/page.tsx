"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsEksCluster } from "@/lib/aws/types";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  CREATING: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  DELETING: "text-red-400 bg-red-500/10 border-red-500/20",
  FAILED: "text-red-400 bg-red-500/10 border-red-500/20",
  UPDATING: "text-sky-400 bg-sky-500/10 border-sky-500/20",
};

function isOpenToWorld(cluster: AwsEksCluster): boolean {
  return cluster.endpointPublicAccess && cluster.publicAccessCidrs.includes("0.0.0.0/0");
}

export default function EksPage() {
  const [clusters, setClusters] = useState<AwsEksCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsEksCluster | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setClusters(snap.eksClusters ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(clusters.map((c) => c.accountId))].sort();

  const filtered = clusters.filter(
    (c) =>
      (!accountFilter || c.accountId === accountFilter) &&
      (c.clusterName.toLowerCase().includes(search.toLowerCase()) ||
        c.accountId.toLowerCase().includes(search.toLowerCase()) ||
        c.region.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="EKS Clusters"
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
                <th className="px-4 py-3 text-left">Cluster</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Version</th>
                <th className="px-4 py-3 text-left">Public Endpoint</th>
                <th className="px-4 py-3 text-left">Logging</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-t border-slate-700/30">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                filtered.map((cluster) => {
                  const openWorld = isOpenToWorld(cluster);
                  const statusUpper = cluster.status.toUpperCase();
                  return (
                    <tr
                      key={cluster.arn}
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(cluster)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(cluster)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.arn === cluster.arn && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{cluster.clusterName}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                          {cluster.accountId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{cluster.region}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs font-mono">{cluster.kubernetesVersion}</td>
                      <td className="px-4 py-3">
                        {cluster.endpointPublicAccess ? (
                          <span
                            className={cn(
                              "flex items-center gap-1 text-xs font-medium",
                              openWorld ? "text-red-400" : "text-amber-400"
                            )}
                          >
                            {openWorld && <AlertTriangle className="w-3 h-3" />}
                            {openWorld ? "0.0.0.0/0" : "Restricted"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Private only</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            cluster.loggingEnabled
                              ? "text-emerald-400 bg-emerald-500/10"
                              : "text-slate-400 bg-slate-700/40"
                          )}
                        >
                          {cluster.loggingEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-medium border",
                            STATUS_COLORS[statusUpper] ?? "text-slate-400 bg-slate-700/40 border-slate-600/40"
                          )}
                        >
                          {cluster.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No EKS clusters found.
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
        title={selected?.clusterName ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && <EksDrawerContent cluster={selected} />}
      </DetailDrawer>
    </>
  );
}

function EksDrawerContent({ cluster }: { cluster: AwsEksCluster }) {
  const openWorld = isOpenToWorld(cluster);
  return (
    <>
      <DrawerSection label="Cluster Details">
        <DrawerField label="Name" value={cluster.clusterName} mono />
        <DrawerField label="ARN" value={cluster.arn} mono />
        <DrawerField label="Account" value={cluster.accountId} mono />
        <DrawerField label="Region" value={cluster.region} />
        <DrawerField label="K8s Version" value={cluster.kubernetesVersion} mono />
        <DrawerField label="Status" value={cluster.status} />
        <DrawerField label="VPC ID" value={cluster.vpcId} mono />
        <DrawerField label="Role ARN" value={cluster.roleArn} mono />
        <DrawerField label="Created" value={new Date(cluster.createdAt).toLocaleString()} />
      </DrawerSection>

      <DrawerSection label="Endpoint Access">
        <DrawerField
          label="Public Access"
          value={
            <span className={cluster.endpointPublicAccess ? "text-amber-400" : "text-slate-400"}>
              {cluster.endpointPublicAccess ? "Enabled" : "Disabled"}
            </span>
          }
        />
        <DrawerField
          label="Private Access"
          value={
            <span className={cluster.endpointPrivateAccess ? "text-emerald-400" : "text-slate-400"}>
              {cluster.endpointPrivateAccess ? "Enabled" : "Disabled"}
            </span>
          }
        />
        {cluster.endpointPublicAccess && (
          <DrawerField
            label="Public Access CIDRs"
            value={
              <div className="flex flex-wrap gap-1 justify-end">
                {cluster.publicAccessCidrs.map((cidr) => (
                  <span
                    key={cidr}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-xs font-mono",
                      cidr === "0.0.0.0/0"
                        ? "bg-red-900/40 text-red-300 border border-red-700/50"
                        : "bg-slate-700 text-slate-300"
                    )}
                  >
                    {cidr}
                  </span>
                ))}
              </div>
            }
          />
        )}
      </DrawerSection>

      {openWorld && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">Open Endpoint Warning</p>
              <p className="text-xs text-red-300/70 mt-1">
                This cluster API endpoint is accessible from 0.0.0.0/0. Restrict publicAccessCidrs to trusted
                IP ranges.
              </p>
            </div>
          </div>
        </div>
      )}

      <DrawerSection label="Logging">
        <DrawerField
          label="Control Plane Logging"
          value={
            <span className={cluster.loggingEnabled ? "text-emerald-400" : "text-amber-400"}>
              {cluster.loggingEnabled ? "Enabled" : "Disabled"}
            </span>
          }
        />
      </DrawerSection>

      {Object.keys(cluster.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(cluster.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
