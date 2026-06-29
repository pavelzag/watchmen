"use client";

import { useEffect, useState, useCallback } from "react";
import DetailPageHeader from "@/components/DetailPageHeader";
import DetailDrawer, { DrawerSection, DrawerField } from "@/components/DetailDrawer";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";
import { collectGcpUsers } from "@/lib/gcp/principals";
import type { GcpSnapshot, StorageBucket, GkeCluster } from "@/lib/gcp/types";

type SortDir = "asc" | "desc";

interface UserRow {
  email: string;
  projects: string[];
  roles: string[];
  resourceTypes: string[];
  highestRole: string;
}

const ROLE_PRIORITY: Record<string, number> = {
  "roles/owner": 5,
  "roles/editor": 4,
  "roles/compute.admin": 3,
  "roles/storage.admin": 3,
  "roles/container.admin": 3,
  "roles/bigquery.admin": 3,
  "roles/viewer": 2,
};

function highestRole(roles: string[]): string {
  let best = roles[0] ?? "roles/viewer";
  let bestPriority = 0;
  for (const r of roles) {
    const p = ROLE_PRIORITY[r] ?? 1;
    if (p > bestPriority) { bestPriority = p; best = r; }
  }
  return best.replace("roles/", "");
}

const ROLE_COLORS: Record<string, string> = {
  owner: "text-red-400 bg-red-500/10 border-red-500/20",
  editor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  viewer: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function roleBadge(role: string) {
  const short = role.replace("roles/", "").split(".").pop() ?? role;
  const color = ROLE_COLORS[short] ?? "text-sky-400 bg-sky-500/10 border-sky-500/20";
  return { short, color };
}

function SortHeader({ label, active, dir, onSort }: { label: string; active: boolean; dir: SortDir; onSort: () => void }) {
  return (
    <th className="px-4 py-3 text-left cursor-pointer select-none group" onClick={onSort}>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400 group-hover:text-slate-200 transition-colors">
        {label}
        <span className="w-3">
          {active
            ? dir === "asc" ? <ChevronUp className="w-3 h-3 text-sky-400" /> : <ChevronDown className="w-3 h-3 text-sky-400" />
            : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />}
        </span>
      </div>
    </th>
  );
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [snapshot, setSnapshot] = useState<GcpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    fetch("/api/gcp/snapshot")
      .then((r) => r.json())
      .then((snap: GcpSnapshot) => {
        setSnapshot(snap);
        setRows(
          collectGcpUsers(snap).map((user) => ({
            ...user,
            highestRole: highestRole(user.roles),
          }))
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleSort = useCallback(() => setSortDir((d) => d === "asc" ? "desc" : "asc"), []);

  const projectOptions = [...new Set(rows.flatMap((r) => r.projects))].sort();

  const filtered = rows
    .filter((r) =>
      (!projectFilter || r.projects.includes(projectFilter)) &&
      (r.email.toLowerCase().includes(search.toLowerCase()) ||
      r.projects.some((p) => p.includes(search.toLowerCase())))
    )
    .sort((a, b) => {
      const cmp = a.email.localeCompare(b.email);
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <>
      <div>
        <DetailPageHeader title="Human Users" count={loading ? null : filtered.length} search={search} onSearch={setSearch} projects={projectOptions} projectFilter={projectFilter} onProjectFilter={setProjectFilter} />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                <SortHeader label="Email" active dir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Projects</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">Highest Role</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-400">All Roles</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(5)].map((_, i) => (
                <tr key={i} className="border-t border-slate-700/30">
                  <td className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse w-40" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse w-20" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse w-16" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse w-32" /></td>
                </tr>
              ))}
              {!loading && filtered.map((row) => {
                const { short, color } = roleBadge(row.highestRole);
                return (
                  <tr
                    key={row.email}
                    data-nav
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    className={cn(
                      "border-t border-slate-700/30 cursor-pointer transition-colors hover:bg-sky-500/5",
                      selected?.email === row.email && "bg-sky-500/10"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-slate-200 text-xs">{row.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.projects.map((p) => (
                          <span key={p} className="px-1.5 py-0.5 rounded text-xs bg-slate-700/60 text-slate-300">{p}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", color)}>{short}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.roles.slice(0, 4).map((r) => (
                          <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 font-mono">
                            {r.replace("roles/", "")}
                          </span>
                        ))}
                        {row.roles.length > 4 && (
                          <span className="text-xs text-slate-500">+{row.roles.length - 4} more</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.email ?? ""}
        subtitle={`${selected?.projects.length ?? 0} project${selected?.projects.length === 1 ? "" : "s"}`}
      >
        {selected && snapshot && (
          <UserDrawerContent user={selected} snapshot={snapshot} />
        )}
      </DetailDrawer>
    </>
  );
}

function UserDrawerContent({ user, snapshot }: { user: UserRow; snapshot: GcpSnapshot }) {
  const { short, color } = roleBadge(user.highestRole);
  const member = `user:${user.email}`;
  const deletedMember = `deleted:user:${user.email}`;

  const includesUser = (binding: { members: string[] }) =>
    binding.members.some((candidate) => candidate === member || candidate.startsWith(`${deletedMember}?`));

  // Project-level bindings for this user
  const projectAccess = snapshot.projects
    .map((p) => ({
      projectId: p.projectId,
      roles: p.bindings.filter(includesUser).map((b) => b.role),
    }))
    .filter((p) => p.roles.length > 0);

  // Buckets this user has explicit access to
  const bucketAccess: StorageBucket[] = snapshot.storageBuckets.filter((b) =>
    b.iamPolicy.bindings.some(includesUser)
  );

  // GKE clusters this user has explicit access to
  const clusterAccess: GkeCluster[] = snapshot.gkeClusters.filter((c) =>
    c.iamPolicy.bindings.some(includesUser)
  );

  return (
    <>
      <DrawerSection label="Identity">
        <DrawerField label="Email" value={user.email} mono />
        <DrawerField label="Projects" value={user.projects.join(", ")} mono />
        <DrawerField label="Resource Types" value={user.resourceTypes.join(", ")} mono />
        <DrawerField label="Highest Role" value={
          <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", color)}>{short}</span>
        } />
      </DrawerSection>

      <DrawerSection label={`Project Access (${projectAccess.length})`}>
        {projectAccess.length === 0 ? (
          <p className="text-xs text-slate-500">No direct project bindings.</p>
        ) : (
          <div className="space-y-4">
            {projectAccess.map(({ projectId, roles }) => (
              <div key={projectId} className="space-y-1.5">
                <p className="text-xs font-mono text-slate-300">{projectId}</p>
                <div className="flex flex-wrap gap-1 pl-2">
                  {roles.map((r) => {
                    const { short: s, color: c } = roleBadge(r);
                    return (
                      <span key={r} className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", c)}>
                        {s}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`Bucket Access (${bucketAccess.length})`}>
        {bucketAccess.length === 0 ? (
          <p className="text-xs text-slate-500">No explicit bucket-level bindings.</p>
        ) : (
          <div className="space-y-3">
            {bucketAccess.map((bucket) => {
              const roles = bucket.iamPolicy.bindings
                .filter(includesUser)
                .map((b) => b.role);
              return (
                <div key={bucket.name} className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2 space-y-1">
                  <p className="text-xs font-mono text-slate-200">{bucket.name}</p>
                  <p className="text-xs text-slate-500">{bucket.projectId} · {bucket.location}</p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {roles.map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-sky-900/30 border border-sky-700/30 text-sky-300 font-mono">
                        {r.replace("roles/", "")}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`GKE Cluster Access (${clusterAccess.length})`}>
        {clusterAccess.length === 0 ? (
          <p className="text-xs text-slate-500">No explicit cluster-level bindings.</p>
        ) : (
          <div className="space-y-3">
            {clusterAccess.map((cluster) => {
              const roles = cluster.iamPolicy.bindings
                .filter(includesUser)
                .map((b) => b.role);
              return (
                <div key={cluster.name} className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2 space-y-1">
                  <p className="text-xs font-mono text-slate-200">{cluster.name}</p>
                  <p className="text-xs text-slate-500">{cluster.projectId} · {cluster.location}</p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {roles.map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-emerald-900/30 border border-emerald-700/30 text-emerald-300 font-mono">
                        {r.replace("roles/", "")}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DrawerSection>

      <DrawerSection label={`All Roles (${user.roles.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {user.roles.map((r) => (
            <span key={r} className="px-2 py-1 rounded-lg text-xs font-mono bg-slate-800 border border-slate-700 text-slate-300">
              {r.replace("roles/", "")}
            </span>
          ))}
        </div>
      </DrawerSection>
    </>
  );
}
