"use client";

import { useEffect, useState } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsIamRole, AwsIamStatement } from "@/lib/aws/types";

export default function IamRolesPage() {
  const [roles, setRoles] = useState<AwsIamRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsIamRole | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setRoles(snap.iamRoles ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(roles.map((r) => r.accountId))].sort();

  const filtered = roles.filter(
    (r) =>
      (!accountFilter || r.accountId === accountFilter) &&
      (r.roleName.toLowerCase().includes(search.toLowerCase()) ||
        r.accountId.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="IAM Roles"
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
                <th className="px-4 py-3 text-left">Role Name</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">Attached Policies</th>
                <th className="px-4 py-3 text-left">Max Session</th>
                <th className="px-4 py-3 text-left">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-t border-slate-700/30">
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                filtered.map((role) => {
                  const sessionHours = Math.round(role.maxSessionDuration / 3600);
                  return (
                    <tr
                      key={role.roleId}
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(role)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(role)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.roleId === role.roleId && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{role.roleName}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                          {role.accountId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{role.attachedPolicies.length}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{sessionHours}h</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {role.lastUsedDate
                          ? new Date(role.lastUsedDate).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No IAM roles found.
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
        title={selected?.roleName ?? ""}
        subtitle={selected?.accountId}
      >
        {selected && <IamRoleDrawer role={selected} />}
      </DetailDrawer>
    </>
  );
}

function StatementBlock({ stmt }: { stmt: AwsIamStatement }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-xs font-medium",
            stmt.effect === "Allow"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          )}
        >
          {stmt.effect}
        </span>
      </div>
      <p className="text-xs text-slate-500 font-medium">Principals</p>
      <div className="flex flex-wrap gap-1 pl-2">
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
      <p className="text-xs text-slate-500 font-medium">Actions</p>
      <div className="flex flex-wrap gap-1 pl-2">
        {stmt.actions.map((a) => (
          <span key={a} className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-700 text-sky-300">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

function IamRoleDrawer({ role }: { role: AwsIamRole }) {
  return (
    <>
      <DrawerSection label="Role Details">
        <DrawerField label="Role Name" value={role.roleName} mono />
        <DrawerField label="Role ID" value={role.roleId} mono />
        <DrawerField label="ARN" value={role.arn} mono />
        <DrawerField label="Account" value={role.accountId} mono />
        <DrawerField label="Created" value={new Date(role.createDate).toLocaleString()} />
        <DrawerField label="Max Session" value={`${Math.round(role.maxSessionDuration / 3600)}h`} />
        {role.lastUsedDate && (
          <DrawerField
            label="Last Used"
            value={`${new Date(role.lastUsedDate).toLocaleDateString()}${role.lastUsedRegion ? ` (${role.lastUsedRegion})` : ""}`}
          />
        )}
      </DrawerSection>

      <DrawerSection label={`Assume Role Policy (${role.assumeRolePolicyStatements.length} statements)`}>
        {role.assumeRolePolicyStatements.length === 0 ? (
          <p className="text-xs text-slate-500">No statements.</p>
        ) : (
          <div className="space-y-2">
            {role.assumeRolePolicyStatements.map((stmt, i) => (
              <StatementBlock key={i} stmt={stmt} />
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`Attached Policies (${role.attachedPolicies.length})`}>
        {role.attachedPolicies.length === 0 ? (
          <p className="text-xs text-slate-500">No attached policies.</p>
        ) : (
          <div className="space-y-1">
            {role.attachedPolicies.map((p) => (
              <p key={p} className="text-xs font-mono text-sky-400 break-all">
                {p}
              </p>
            ))}
          </div>
        )}
      </DrawerSection>

      {role.inlinePolicies.length > 0 && (
        <DrawerSection label={`Inline Policies (${role.inlinePolicies.length})`}>
          <div className="space-y-1">
            {role.inlinePolicies.map((p) => (
              <p key={p} className="text-xs font-mono text-amber-400">
                {p}
              </p>
            ))}
          </div>
        </DrawerSection>
      )}

      {Object.keys(role.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(role.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
