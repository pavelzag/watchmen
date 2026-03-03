"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsRedshiftCluster, AwsSnapshot } from "@/lib/aws/types";

export default function AwsRedshiftPage() {
  const [clusters, setClusters] = useState<AwsRedshiftCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsRedshiftCluster | null>(null);

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap: AwsSnapshot) => setClusters(snap.redshiftClusters ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const filtered = clusters.filter(
    (c) =>
      c.clusterIdentifier.toLowerCase().includes(search.toLowerCase()) ||
      c.accountId.toLowerCase().includes(search.toLowerCase()) ||
      c.region.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div>
        <DetailPageHeader title="Redshift Clusters" count={loading ? null : filtered.length} search={search} onSearch={setSearch} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Cluster</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Node Type</th>
                <th className="px-4 py-3 text-left">Nodes</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Public</th>
                <th className="px-4 py-3 text-left">Encrypted</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(3)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((cluster) => (
                <tr
                  key={cluster.clusterIdentifier}
                  data-nav
                  tabIndex={0}
                  onClick={() => setSelected(cluster)}
                  className={cn(
                    "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                    selected?.clusterIdentifier === cluster.clusterIdentifier && "bg-sky-500/10"
                  )}
                >
                  <td className="px-4 py-3 font-mono text-slate-200 text-xs">{cluster.clusterIdentifier}</td>
                  <td className="px-4 py-3"><span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{cluster.accountId}</span></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{cluster.region}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs font-mono">{cluster.nodeType}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{cluster.numberOfNodes}</td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border",
                      cluster.clusterStatus === "available" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                    )}>
                      {cluster.clusterStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {cluster.publiclyAccessible ? (
                      <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle className="w-3 h-3" /> Public</span>
                    ) : (
                      <span className="text-xs text-slate-500">Private</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {cluster.encrypted ? (
                      <span className="text-xs text-emerald-400">Encrypted</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-400"><AlertTriangle className="w-3 h-3" /> None</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No Redshift clusters found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.clusterIdentifier ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && (
          <>
            <DrawerSection label="Cluster Details">
              <DrawerField label="Identifier" value={selected.clusterIdentifier} mono />
              <DrawerField label="Account" value={selected.accountId} mono />
              <DrawerField label="Region" value={selected.region} mono />
              <DrawerField label="Node Type" value={selected.nodeType} mono />
              <DrawerField label="Nodes" value={String(selected.numberOfNodes)} />
              <DrawerField label="Status" value={selected.clusterStatus} />
              <DrawerField label="DB Name" value={selected.dbName} mono />
              <DrawerField label="Master User" value={selected.masterUsername} mono />
            </DrawerSection>
            <DrawerSection label="Security">
              <DrawerField label="Publicly Accessible" value={
                selected.publiclyAccessible
                  ? <span className="text-xs text-red-400 font-medium">Yes — public access enabled</span>
                  : <span className="text-xs text-emerald-400">No</span>
              } />
              <DrawerField label="Encryption" value={
                selected.encrypted
                  ? <span className="text-xs text-emerald-400">Encrypted at rest</span>
                  : <span className="text-xs text-amber-400">Not encrypted</span>
              } />
              <DrawerField label="Enhanced VPC Routing" value={selected.enhancedVpcRouting ? "Enabled" : "Disabled"} />
            </DrawerSection>
            {selected.endpoint && (
              <DrawerSection label="Endpoint">
                <DrawerField label="Address" value={selected.endpoint.address} mono />
                <DrawerField label="Port" value={String(selected.endpoint.port)} />
              </DrawerSection>
            )}
            {Object.keys(selected.tags).length > 0 && (
              <DrawerSection label="Tags">
                {Object.entries(selected.tags).map(([k, v]) => (
                  <DrawerField key={k} label={k} value={v} mono />
                ))}
              </DrawerSection>
            )}
          </>
        )}
      </DetailDrawer>
    </>
  );
}
