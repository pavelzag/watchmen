"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsLambdaFunction } from "@/lib/aws/types";

function hasPublicPolicy(fn: AwsLambdaFunction): boolean {
  return fn.resourcePolicy.some((s) => s.effect === "Allow" && s.principals.includes("*"));
}

const RUNTIME_COLORS: Record<string, string> = {
  "nodejs18.x": "text-emerald-400",
  "nodejs20.x": "text-emerald-400",
  "python3.11": "text-sky-400",
  "python3.12": "text-sky-400",
  "java17": "text-amber-400",
  "java21": "text-amber-400",
  "go1.x": "text-violet-400",
};

export default function LambdaPage() {
  const [functions, setFunctions] = useState<AwsLambdaFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsLambdaFunction | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setFunctions(snap.lambdaFunctions ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(functions.map((f) => f.accountId))].sort();

  const filtered = functions.filter(
    (f) =>
      (!accountFilter || f.accountId === accountFilter) &&
      (f.functionName.toLowerCase().includes(search.toLowerCase()) ||
        f.accountId.toLowerCase().includes(search.toLowerCase()) ||
        f.region.toLowerCase().includes(search.toLowerCase()) ||
        f.runtime.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="Lambda Functions"
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
                <th className="px-4 py-3 text-left">Function</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Runtime</th>
                <th className="px-4 py-3 text-left">Memory</th>
                <th className="px-4 py-3 text-left">Timeout</th>
                <th className="px-4 py-3 text-left">VPC</th>
                <th className="px-4 py-3 text-left">Public Policy</th>
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
                filtered.map((fn) => {
                  const pubPolicy = hasPublicPolicy(fn);
                  const inVpc = !!fn.vpcConfig?.vpcId;
                  return (
                    <tr
                      key={fn.functionArn}
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(fn)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(fn)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.functionArn === fn.functionArn && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{fn.functionName}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                          {fn.accountId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fn.region}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <span className={RUNTIME_COLORS[fn.runtime] ?? "text-slate-400"}>
                          {fn.runtime}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fn.memorySize} MB</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fn.timeout}s</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            inVpc ? "text-emerald-400 bg-emerald-500/10" : "text-slate-500"
                          )}
                        >
                          {inVpc ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pubPolicy ? (
                          <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                            <AlertTriangle className="w-3 h-3" /> Public
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Private</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No Lambda functions found.
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
        title={selected?.functionName ?? ""}
        subtitle={`${selected?.accountId} / ${selected?.region}`}
      >
        {selected && <LambdaDrawerContent fn={selected} />}
      </DetailDrawer>
    </>
  );
}

function LambdaDrawerContent({ fn }: { fn: AwsLambdaFunction }) {
  const pubPolicy = hasPublicPolicy(fn);
  return (
    <>
      <DrawerSection label="Function Details">
        <DrawerField label="Name" value={fn.functionName} mono />
        <DrawerField label="ARN" value={fn.functionArn} mono />
        <DrawerField label="Account" value={fn.accountId} mono />
        <DrawerField label="Region" value={fn.region} />
        <DrawerField label="Runtime" value={fn.runtime} mono />
        <DrawerField label="Memory" value={`${fn.memorySize} MB`} />
        <DrawerField label="Timeout" value={`${fn.timeout}s`} />
        <DrawerField label="Code Size" value={`${(fn.codeSize / 1024).toFixed(1)} KB`} />
        <DrawerField label="Last Modified" value={new Date(fn.lastModified).toLocaleString()} />
        {fn.state && <DrawerField label="State" value={fn.state} />}
      </DrawerSection>

      <DrawerSection label="Execution Role">
        <DrawerField label="Role ARN" value={fn.role} mono />
      </DrawerSection>

      {fn.vpcConfig?.vpcId && (
        <DrawerSection label="VPC Configuration">
          <DrawerField label="VPC ID" value={fn.vpcConfig.vpcId} mono />
          {fn.vpcConfig.subnetIds.length > 0 && (
            <DrawerField
              label="Subnets"
              value={
                <div className="flex flex-wrap gap-1 justify-end">
                  {fn.vpcConfig.subnetIds.map((s) => (
                    <span key={s} className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700 text-slate-300">
                      {s}
                    </span>
                  ))}
                </div>
              }
            />
          )}
          {fn.vpcConfig.securityGroupIds.length > 0 && (
            <DrawerField
              label="Security Groups"
              value={
                <div className="flex flex-wrap gap-1 justify-end">
                  {fn.vpcConfig.securityGroupIds.map((sg) => (
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

      <DrawerSection label={`Resource Policy (${fn.resourcePolicy.length} statements)`}>
        {fn.resourcePolicy.length === 0 ? (
          <p className="text-xs text-slate-500">No resource policy.</p>
        ) : (
          <div className="space-y-2">
            {fn.resourcePolicy.map((stmt, i) => (
              <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-1.5">
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
                        p === "*"
                          ? "bg-red-900/40 text-red-300 border border-red-700/50"
                          : "bg-slate-700 text-slate-300"
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
            ))}
          </div>
        )}
      </DrawerSection>

      {pubPolicy && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">Public Policy Warning</p>
              <p className="text-xs text-red-300/70 mt-1">
                This function allows invocation by any principal (Principal: '*'). Restrict the resource policy.
              </p>
            </div>
          </div>
        </div>
      )}

      {Object.keys(fn.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(fn.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
