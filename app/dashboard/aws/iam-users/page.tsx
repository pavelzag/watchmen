"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import type { AwsIamUser, AwsAccessKey } from "@/lib/aws/types";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function isKeyStale(key: AwsAccessKey): boolean {
  if (!key.lastUsedDate) return true;
  return Date.now() - new Date(key.lastUsedDate).getTime() > NINETY_DAYS_MS;
}

function activeKeyCount(user: AwsIamUser): number {
  return user.accessKeys.filter((k) => k.status === "Active").length;
}

function hasKeyWarning(user: AwsIamUser): boolean {
  const active = user.accessKeys.filter((k) => k.status === "Active");
  if (active.length > 1) return true;
  return active.some((k) => isKeyStale(k));
}

export default function IamUsersPage() {
  const [users, setUsers] = useState<AwsIamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AwsIamUser | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  useEffect(() => {
    fetch("/api/aws/snapshot")
      .then((r) => r.json())
      .then((snap) => setUsers(snap.iamUsers ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

  const accountOptions = [...new Set(users.map((u) => u.accountId))].sort();

  const filtered = users.filter(
    (u) =>
      (!accountFilter || u.accountId === accountFilter) &&
      (u.userName.toLowerCase().includes(search.toLowerCase()) ||
        u.accountId.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <div>
        <DetailPageHeader
          title="IAM Users"
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
                <th className="px-4 py-3 text-left">Username</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="px-4 py-3 text-left">MFA</th>
                <th className="px-4 py-3 text-left">Access Keys</th>
                <th className="px-4 py-3 text-left">Attached Policies</th>
                <th className="px-4 py-3 text-left">Groups</th>
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
                filtered.map((user) => {
                  const activeKeys = activeKeyCount(user);
                  const keyWarn = hasKeyWarning(user);
                  return (
                    <tr
                      key={user.userId}
                      data-nav
                      tabIndex={0}
                      onClick={() => setSelected(user)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(user)}
                      className={cn(
                        "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                        selected?.userId === user.userId && "bg-sky-500/10"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-slate-200 text-xs">{user.userName}</td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">
                          {user.accountId}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {user.mfaEnabled ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Enabled
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "flex items-center gap-1 text-xs",
                            keyWarn ? "text-red-400" : "text-slate-400"
                          )}
                        >
                          {keyWarn && <AlertTriangle className="w-3 h-3" />}
                          {activeKeys} active
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {user.attachedPolicies.length}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {user.groups.length > 0 ? user.groups.join(", ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No IAM users found.
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
        title={selected?.userName ?? ""}
        subtitle={selected?.accountId}
      >
        {selected && <IamUserDrawer user={selected} />}
      </DetailDrawer>
    </>
  );
}

function IamUserDrawer({ user }: { user: AwsIamUser }) {
  const activeKeys = user.accessKeys.filter((k) => k.status === "Active");
  return (
    <>
      <DrawerSection label="User Details">
        <DrawerField label="Username" value={user.userName} mono />
        <DrawerField label="User ID" value={user.userId} mono />
        <DrawerField label="ARN" value={user.arn} mono />
        <DrawerField label="Account" value={user.accountId} mono />
        <DrawerField label="Created" value={new Date(user.createDate).toLocaleString()} />
        {user.passwordLastUsed && (
          <DrawerField label="Password Last Used" value={new Date(user.passwordLastUsed).toLocaleString()} />
        )}
        <DrawerField
          label="MFA"
          value={
            user.mfaEnabled ? (
              <span className="text-xs text-emerald-400 font-medium">Enabled</span>
            ) : (
              <span className="text-xs text-red-400 font-medium">Disabled</span>
            )
          }
        />
      </DrawerSection>

      <DrawerSection label={`Access Keys (${user.accessKeys.length})`}>
        {user.accessKeys.length === 0 ? (
          <p className="text-xs text-slate-500">No access keys.</p>
        ) : (
          <div className="space-y-3">
            {user.accessKeys.map((key) => {
              const stale = key.status === "Active" && isKeyStale(key);
              return (
                <div
                  key={key.accessKeyId}
                  className={cn(
                    "rounded-lg border p-3 space-y-1",
                    stale
                      ? "border-red-500/30 bg-red-500/5"
                      : key.status === "Active"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-slate-700/50 bg-slate-800/30"
                  )}
                >
                  <p className="text-xs font-mono text-slate-200">{key.accessKeyId}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs font-medium",
                        key.status === "Active"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-slate-700 text-slate-400"
                      )}
                    >
                      {key.status}
                    </span>
                    {stale && (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <AlertTriangle className="w-3 h-3" /> Stale
                      </span>
                    )}
                  </div>
                  {key.lastUsedDate && (
                    <p className="text-xs text-slate-500">
                      Last used: {new Date(key.lastUsedDate).toLocaleDateString()}
                      {key.lastUsedService && ` via ${key.lastUsedService}`}
                    </p>
                  )}
                  {!key.lastUsedDate && <p className="text-xs text-slate-500">Never used</p>}
                </div>
              );
            })}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`Attached Policies (${user.attachedPolicies.length})`}>
        {user.attachedPolicies.length === 0 ? (
          <p className="text-xs text-slate-500">No attached policies.</p>
        ) : (
          <div className="space-y-1">
            {user.attachedPolicies.map((p) => (
              <p key={p} className="text-xs font-mono text-sky-400 break-all">
                {p}
              </p>
            ))}
          </div>
        )}
      </DrawerSection>

      {user.groups.length > 0 && (
        <DrawerSection label={`Groups (${user.groups.length})`}>
          <div className="flex flex-wrap gap-1">
            {user.groups.map((g) => (
              <span key={g} className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300 font-mono">
                {g}
              </span>
            ))}
          </div>
        </DrawerSection>
      )}

      {Object.keys(user.tags).length > 0 && (
        <DrawerSection label="Tags">
          <div className="space-y-1">
            {Object.entries(user.tags).map(([k, v]) => (
              <DrawerField key={k} label={k} value={v} mono />
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
