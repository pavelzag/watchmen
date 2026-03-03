"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsRdsInstance } from "@/lib/aws/types";

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "available":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "creating":
    case "modifying":
    case "rebooting":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "deleting":
    case "failed":
    case "stopped":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    default:
      return "text-slate-400 bg-slate-700/40 border-slate-600/40";
  }
}

export default function RdsPage() {
  const [instances, setInstances] = useState<AwsRdsInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsRdsInstance | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setInstances(snap.rdsInstances ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(instances.map((i) => i.accountId))].sort();

  const filtered = instances.filter(
    (inst) =>
      (!accountFilter || inst.accountId === accountFilter) &&
      (inst.dbInstanceIdentifier.toLowerCase().includes(search.toLowerCase()) ||
        inst.accountId.toLowerCase().includes(search.toLowerCase()) ||
        inst.region.toLowerCase().includes(search.toLowerCase()) ||
        inst.dbEngine.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="RDS Instances"
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
                <th className="px-4 py-3 text-left">Identifier</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Engine</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Public</th>
                <th className="px-4 py-3 text-left">Encrypted</th>
                <th className="px-4 py-3 text-left">Multi-AZ</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-t border-slate-700/30">
                    {[...Array(9)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                filtered.map((inst) => (
                  <tr
                    key={inst.dbInstanceArn}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(inst)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(inst)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.dbInstanceArn === inst.dbInstanceArn && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{inst.dbInstanceIdentifier}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                        {inst.accountId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{inst.region}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {inst.dbEngine} {inst.dbEngineVersion}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-xs">{inst.dbInstanceClass}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", statusColor(inst.dbInstanceStatus))}>
                        {inst.dbInstanceStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {inst.publiclyAccessible ? (
                        <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                          <AlertTriangle className="w-3 h-3" /> Public
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Private</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          inst.storageEncrypted
                            ? "text-emerald-400 bg-emerald-500/10"
                            : "text-red-400 bg-red-500/10"
                        )}
                      >
                        {inst.storageEncrypted ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          inst.multiAz ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400 bg-slate-700/40"
                        )}
                      >
                        {inst.multiAz ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No RDS instances found.
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
        title={selected?.dbInstanceIdentifier ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && <RdsDrawerContent inst={selected} />}
      </DetailDrawer>
    </>
  );
}

function RdsDrawerContent({ inst }: { inst: AwsRdsInstance }) {
  return (
    <>
      <DrawerSection label="Instance Details">
        <DrawerField label="Identifier" value={inst.dbInstanceIdentifier} mono />
        <DrawerField label="ARN" value={inst.dbInstanceArn} mono />
        <DrawerField label="Account" value={inst.accountId} mono />
        <DrawerField label="Region" value={inst.region} />
        <DrawerField label="Engine" value={`${inst.dbEngine} ${inst.dbEngineVersion}`} mono />
        <DrawerField label="Instance Class" value={inst.dbInstanceClass} mono />
        <DrawerField
          label="Status"
          value={
            <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", statusColor(inst.dbInstanceStatus))}>
              {inst.dbInstanceStatus}
            </span>
          }
        />
        <DrawerField
          label="Publicly Accessible"
          value={
            <span className={inst.publiclyAccessible ? "text-red-400 font-medium" : "text-slate-400"}>
              {inst.publiclyAccessible ? "Yes" : "No"}
            </span>
          }
        />
        <DrawerField
          label="Storage Encrypted"
          value={
            <span className={inst.storageEncrypted ? "text-emerald-400" : "text-red-400"}>
              {inst.storageEncrypted ? "Yes" : "No"}
            </span>
          }
        />
        <DrawerField
          label="Multi-AZ"
          value={
            <span className={inst.multiAz ? "text-emerald-400" : "text-slate-400"}>
              {inst.multiAz ? "Yes" : "No"}
            </span>
          }
        />
        <DrawerField
          label="Deletion Protection"
          value={
            <span className={inst.deletionProtection ? "text-emerald-400" : "text-amber-400"}>
              {inst.deletionProtection ? "Enabled" : "Disabled"}
            </span>
          }
        />
        <DrawerField label="Backup Retention" value={`${inst.backupRetentionPeriod} days`} />
      </DrawerSection>

      {inst.endpoint && (
        <DrawerSection label="Endpoint">
          <DrawerField label="Address" value={inst.endpoint.address} mono />
          <DrawerField label="Port" value={String(inst.endpoint.port)} />
        </DrawerSection>
      )}

      {inst.vpcId && (
        <DrawerSection label="Network">
          <DrawerField label="VPC ID" value={inst.vpcId} mono />
          {inst.securityGroupIds.length > 0 && (
            <DrawerField
              label="Security Groups"
              value={
                <div className="flex flex-wrap gap-1 justify-end">
                  {inst.securityGroupIds.map((sg) => (
                    <span key={sg} className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700 text-slate-300">
                      {sg}
                    </span>
                  ))}
                </div>
              }
            />
          )}
        </DrawerSection>
      )}

      {Object.keys(inst.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(inst.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
