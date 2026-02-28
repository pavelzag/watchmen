"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField, StatusBadge } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ServiceAccount, GcpSnapshot } from "@/lib/gcp/types";

type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

function fmt(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function keyStatus(validBeforeTime: string): { label: string; color: string; icon: React.ReactNode } {
  const exp = new Date(validBeforeTime);
  const now = new Date();
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  if (daysLeft < 0)
    return { label: `Expired ${fmt(validBeforeTime)}`, color: "text-red-400 bg-red-500/10 border-red-500/20", icon: <XCircle className="w-3 h-3" /> };
  if (daysLeft < 30)
    return { label: `Expires in ${daysLeft}d`, color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <AlertTriangle className="w-3 h-3" /> };
  return { label: `Expires ${fmt(validBeforeTime)}`, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: <CheckCircle2 className="w-3 h-3" /> };
}

function SortHeader({
  label, field, current, dir, onSort,
}: { label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void }) {
  const active = field === current;
  return (
    <th
      className="px-4 py-3 text-left cursor-pointer select-none group"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400 group-hover:text-slate-200 transition-colors">
        {label}
        <span className="w-3">
          {active ? (
            dir === "asc" ? <ChevronUp className="w-3 h-3 text-sky-400" /> : <ChevronDown className="w-3 h-3 text-sky-400" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />
          )}
        </span>
      </div>
    </th>
  );
}

export default function ServiceAccountsPage() {
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<ServiceAccount | null>(null);

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => setAccounts(snap.serviceAccounts ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((d) => field === sortField ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortField(field);
  }, [sortField]);

  const filtered = accounts
    .filter((sa) =>
      sa.email.toLowerCase().includes(search.toLowerCase()) ||
      sa.displayName.toLowerCase().includes(search.toLowerCase()) ||
      sa.projectId.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.email.localeCompare(b.email);
      else cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div>
        <DetailPageHeader
          title="Service Accounts"
          count={loading ? null : filtered.length}
          search={search}
          onSearch={setSearch}
        />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Email / Name" field="name" current={sortField} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Project</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Keys</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Status</th>
                <SortHeader label="Created" field="createdAt" current={sortField} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(5)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  {[...Array(5)].map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {!loading && filtered.map((sa) => {
                const hasExpiredKey = sa.keys.some((k) => new Date(k.validBeforeTime) < new Date());
                const hasMultipleKeys = sa.keys.length > 1;
                return (
                  <tr
                    key={sa.email}
                    onClick={() => setSelected(sa)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors",
                      "hover:bg-sky-500/5",
                      sa.disabled && "opacity-50",
                      selected?.email === sa.email && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-200 text-xs">{sa.email}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{sa.displayName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{sa.projectId}</span>
                    </td>
                    <td className="px-4 py-3">
                      {sa.keys.length === 0 ? (
                        <span className="text-slate-500 text-xs">None</span>
                      ) : (
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-xs font-medium border",
                          hasExpiredKey || hasMultipleKeys
                            ? "text-red-400 bg-red-500/10 border-red-500/20"
                            : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        )}>
                          {sa.keys.length} key{sa.keys.length > 1 ? "s" : ""}
                          {hasExpiredKey && " ⚠"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={!sa.disabled} label={sa.disabled ? "Disabled" : "Active"} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmt(sa.createdAt)}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">No service accounts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.displayName ?? ""}
        subtitle={selected?.email}
      >
        {selected && <SADrawerContent sa={selected} />}
      </DetailDrawer>
    </>
  );
}

function SADrawerContent({ sa }: { sa: ServiceAccount }) {
  return (
    <>
      <DrawerSection label="Identity">
        <DrawerField label="Email" value={sa.email} mono />
        <DrawerField label="Project" value={sa.projectId} mono />
        <DrawerField label="Unique ID" value={sa.uniqueId} mono />
        <DrawerField label="Status" value={<StatusBadge active={!sa.disabled} label={sa.disabled ? "Disabled" : "Active"} />} />
        <DrawerField label="Created" value={fmt(sa.createdAt)} />
        {sa.description && <DrawerField label="Description" value={sa.description} />}
      </DrawerSection>

      <DrawerSection label={`Roles (${sa.roles.length})`}>
        {sa.roles.length === 0 ? (
          <p className="text-xs text-slate-500">No roles assigned directly.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sa.roles.map((r) => (
              <span key={r} className="px-2 py-1 rounded-lg text-xs font-mono bg-slate-800 border border-slate-700 text-slate-300">
                {r.replace("roles/", "")}
              </span>
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`Service Account Keys (${sa.keys.length})`}>
        {sa.keys.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No user-managed keys. Using Workload Identity or default credentials.</p>
        ) : (
          <div className="space-y-3">
            {sa.keys.map((key) => {
              const status = keyStatus(key.validBeforeTime);
              return (
                <div key={key.name} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-300">{key.name}</span>
                    <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border", status.color)}>
                      {status.icon}{status.label}
                    </span>
                  </div>
                  <DrawerField label="Type" value={key.keyType} mono />
                  <DrawerField label="Valid after" value={fmt(key.validAfterTime)} />
                  <DrawerField label="Valid before" value={fmt(key.validBeforeTime)} />
                </div>
              );
            })}
          </div>
        )}
      </DrawerSection>
    </>
  );
}
