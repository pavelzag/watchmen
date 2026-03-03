"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsSecurityGroup, AwsSgRule, AwsSnapshot } from "@/lib/aws/types";

function isDangerous(sg: AwsSecurityGroup): boolean {
  return sg.inboundRules.some(
    (r) =>
      (r.cidrRanges.includes("0.0.0.0/0") || r.ipv6CidrRanges.includes("::/0")) &&
      (r.fromPort === 22 || r.toPort === 22 || r.fromPort === 3389 || r.toPort === 3389 || r.protocol === "-1")
  );
}

function isOpenToWorld(r: AwsSgRule): boolean {
  return r.cidrRanges.includes("0.0.0.0/0") || r.ipv6CidrRanges.includes("::/0");
}

function portDisplay(r: AwsSgRule): string {
  if (r.protocol === "-1") return "All";
  if (r.fromPort === r.toPort) return String(r.fromPort ?? "");
  return `${r.fromPort ?? ""}–${r.toPort ?? ""}`;
}

export default function AwsSecurityGroupsPage() {
  const [sgs, setSgs] = useState<AwsSecurityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsSecurityGroup | null>(null);

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap: AwsSnapshot) => setSgs(snap.securityGroups ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const filtered = sgs.filter(
    (sg) =>
      sg.groupName.toLowerCase().includes(search.toLowerCase()) ||
      sg.groupId.toLowerCase().includes(search.toLowerCase()) ||
      sg.accountId.toLowerCase().includes(search.toLowerCase()) ||
      sg.region.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div>
        <DetailPageHeader title="Security Groups" count={loading ? null : filtered.length} search={search} onSearch={setSearch} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Group ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">VPC</th>
                <th className="px-4 py-3 text-left">Inbound</th>
                <th className="px-4 py-3 text-left">Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((sg) => {
                const dangerous = isDangerous(sg);
                return (
                  <tr
                    key={sg.groupId}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(sg)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.groupId === sg.groupId && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">{sg.groupId}</td>
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{sg.groupName}</td>
                    <td className="px-4 py-3"><span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{sg.accountId}</span></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{sg.region}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{sg.vpcId}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{sg.inboundRules.length} rules</td>
                    <td className="px-4 py-3">
                      {dangerous ? (
                        <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle className="w-3 h-3" /> Dangerous</span>
                      ) : (
                        <span className="text-xs text-slate-500">OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No security groups found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.groupName ?? ""}
        subtitle={`${selected?.groupId} / ${selected?.region}`}
      >
        {selected && (
          <>
            <DrawerSection label="Group Details">
              <DrawerField label="Group ID" value={selected.groupId} mono />
              <DrawerField label="Name" value={selected.groupName} mono />
              <DrawerField label="Account" value={selected.accountId} mono />
              <DrawerField label="Region" value={selected.region} mono />
              <DrawerField label="VPC" value={selected.vpcId} mono />
              <DrawerField label="Description" value={selected.description} />
            </DrawerSection>
            <DrawerSection label={`Inbound Rules (${selected.inboundRules.length})`}>
              {selected.inboundRules.length === 0 ? (
                <p className="text-xs text-slate-500">No inbound rules.</p>
              ) : (
                <div className="space-y-2">
                  {selected.inboundRules.map((rule, i) => (
                    <div key={i} className={cn(
                      "rounded-lg border px-3 py-2 space-y-1",
                      isOpenToWorld(rule) ? "bg-red-900/20 border-red-700/40" : "bg-slate-800/40 border-slate-700/40"
                    )}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-slate-300">{rule.protocol === "-1" ? "ALL" : rule.protocol.toUpperCase()}</span>
                        <span className="text-slate-400">port</span>
                        <span className="font-mono text-slate-300">{portDisplay(rule)}</span>
                        {isOpenToWorld(rule) && <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="w-3 h-3" /> 0.0.0.0/0</span>}
                      </div>
                      <p className="text-xs text-slate-400">From: <span className="font-mono text-slate-300">{[...rule.cidrRanges, ...rule.ipv6CidrRanges].join(", ") || "—"}</span></p>
                      {rule.description && <p className="text-xs text-slate-500">{rule.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>
            <DrawerSection label={`Outbound Rules (${selected.outboundRules.length})`}>
              {selected.outboundRules.length === 0 ? (
                <p className="text-xs text-slate-500">No outbound rules.</p>
              ) : (
                <div className="space-y-2">
                  {selected.outboundRules.map((rule, i) => (
                    <div key={i} className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-slate-300">{rule.protocol === "-1" ? "ALL" : rule.protocol.toUpperCase()}</span>
                        <span className="text-slate-400">port</span>
                        <span className="font-mono text-slate-300">{portDisplay(rule)}</span>
                      </div>
                      <p className="text-xs text-slate-400">To: <span className="font-mono text-slate-300">{[...rule.cidrRanges, ...rule.ipv6CidrRanges].join(", ") || "—"}</span></p>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>
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
