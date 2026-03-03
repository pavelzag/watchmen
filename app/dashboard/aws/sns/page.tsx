"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsSnsTopic, AwsSnapshot } from "@/lib/aws/types";

function hasPublicPolicy(topic: AwsSnsTopic): boolean {
  return topic.policy.some(
    (s) =>
      s.effect === "Allow" &&
      s.principals.includes("*") &&
      s.actions.some((a) => a === "SNS:Publish" || a === "sns:Publish" || a === "*")
  );
}

export default function AwsSnsPage() {
  const [topics, setTopics] = useState<AwsSnsTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsSnsTopic | null>(null);

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap: AwsSnapshot) => setTopics(snap.snsTopics ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const filtered = topics.filter(
    (t) =>
      t.topicName.toLowerCase().includes(search.toLowerCase()) ||
      t.accountId.toLowerCase().includes(search.toLowerCase()) ||
      t.region.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div>
        <DetailPageHeader title="SNS Topics" count={loading ? null : filtered.length} search={search} onSearch={setSearch} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Topic</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Subscriptions</th>
                <th className="px-4 py-3 text-left">KMS</th>
                <th className="px-4 py-3 text-left">Public Publish</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(4)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>)}
                </tr>
              ))}
              {!loading && filtered.map((topic) => {
                const isPublic = hasPublicPolicy(topic);
                return (
                  <tr
                    key={topic.topicArn}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(topic)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.topicArn === topic.topicArn && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{topic.topicName}</td>
                    <td className="px-4 py-3"><span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{topic.accountId}</span></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{topic.region}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{topic.subscriptionCount}</td>
                    <td className="px-4 py-3 text-xs">
                      {topic.kmsMasterKeyId ? (
                        <span className="text-emerald-400">Enabled</span>
                      ) : (
                        <span className="text-slate-500">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isPublic ? (
                        <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle className="w-3 h-3" /> Public</span>
                      ) : (
                        <span className="text-xs text-slate-500">Private</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No SNS topics found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.topicName ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && (
          <>
            <DrawerSection label="Topic Details">
              <DrawerField label="Name" value={selected.topicName} mono />
              <DrawerField label="ARN" value={selected.topicArn} mono />
              <DrawerField label="Account" value={selected.accountId} mono />
              <DrawerField label="Region" value={selected.region} mono />
              <DrawerField label="Subscriptions" value={String(selected.subscriptionCount)} />
              <DrawerField label="KMS Key" value={selected.kmsMasterKeyId ?? "None"} mono />
            </DrawerSection>
            {selected.policy.length > 0 && (
              <DrawerSection label={`Policy Statements (${selected.policy.length})`}>
                {selected.policy.map((stmt, i) => (
                  <div key={i} className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2 space-y-1 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", stmt.effect === "Allow" ? "bg-emerald-900/40 text-emerald-300" : "bg-red-900/40 text-red-300")}>
                        {stmt.effect}
                      </span>
                      {stmt.principals.includes("*") && (
                        <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle className="w-3 h-3" /> Public principal</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">Principals: <span className="font-mono text-slate-300">{stmt.principals.join(", ")}</span></p>
                    <p className="text-xs text-slate-400">Actions: <span className="font-mono text-slate-300">{stmt.actions.join(", ")}</span></p>
                  </div>
                ))}
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
