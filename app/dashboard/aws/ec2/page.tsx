"use client";

import { useEffect, useState } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsEc2Instance } from "@/lib/aws/types";

function stateColor(state: string): string {
  switch (state.toLowerCase()) {
    case "running":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "stopped":
    case "stopping":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "terminated":
    case "shutting-down":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    default:
      return "text-slate-400 bg-slate-700/40 border-slate-600/40";
  }
}

export default function Ec2Page() {
  const [instances, setInstances] = useState<AwsEc2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsEc2Instance | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setInstances(snap.ec2Instances ?? []))
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
      (inst.instanceId.toLowerCase().includes(search.toLowerCase()) ||
        (inst.tags.Name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        inst.accountId.toLowerCase().includes(search.toLowerCase()) ||
        inst.region.toLowerCase().includes(search.toLowerCase()) ||
        inst.instanceType.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="EC2 Instances"
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
                <th className="px-4 py-3 text-left">Instance ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-left">Public IP</th>
                <th className="px-4 py-3 text-left">IAM Profile</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-t border-slate-700/30">
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                filtered.map((inst) => (
                  <tr
                    key={inst.instanceId}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(inst)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(inst)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.instanceId === inst.instanceId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{inst.instanceId}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{inst.tags.Name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                        {inst.accountId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{inst.region}</td>
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">{inst.instanceType}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", stateColor(inst.state))}>
                        {inst.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-xs">
                      {inst.publicIpAddress ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-[120px]">
                      {inst.iamInstanceProfileArn
                        ? inst.iamInstanceProfileArn.split("/").pop()
                        : "—"}
                    </td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No EC2 instances found.
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
        title={selected?.tags.Name ?? selected?.instanceId ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && <Ec2DrawerContent inst={selected} />}
      </DetailDrawer>
    </>
  );
}

function Ec2DrawerContent({ inst }: { inst: AwsEc2Instance }) {
  return (
    <>
      <DrawerSection label="Instance Details">
        <DrawerField label="Instance ID" value={inst.instanceId} mono />
        <DrawerField label="Name" value={inst.tags.Name ?? "—"} />
        <DrawerField label="Account" value={inst.accountId} mono />
        <DrawerField label="Region" value={inst.region} />
        <DrawerField label="Instance Type" value={inst.instanceType} mono />
        <DrawerField
          label="State"
          value={
            <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", stateColor(inst.state))}>
              {inst.state}
            </span>
          }
        />
        <DrawerField label="AMI ID" value={inst.imageId} mono />
        <DrawerField label="Launch Time" value={new Date(inst.launchTime).toLocaleString()} />
      </DrawerSection>

      <DrawerSection label="Network">
        <DrawerField label="Public IP" value={inst.publicIpAddress ?? "None"} mono />
        <DrawerField label="Private IP" value={inst.privateIpAddress} mono />
        {inst.vpcId && <DrawerField label="VPC ID" value={inst.vpcId} mono />}
        {inst.subnetId && <DrawerField label="Subnet ID" value={inst.subnetId} mono />}
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

      {inst.iamInstanceProfileArn && (
        <DrawerSection label="IAM">
          <DrawerField label="Instance Profile ARN" value={inst.iamInstanceProfileArn} mono />
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
