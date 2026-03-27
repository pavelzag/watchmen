"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Server, Network, ShieldOff, ShieldCheck,
  Loader2, RefreshCw, ChevronRight, ExternalLink, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GkeEntryPoint, GkeEntryPointType } from "@/lib/gcp/types";

// ─── Type metadata ────────────────────────────────────────────────────────────

const TYPE_META: Record<GkeEntryPointType, { label: string; Icon: any; color: string }> = {
  "master-api":  { label: "MASTER API",  Icon: Globe,    color: "text-sky-400" },
  "lb-service":  { label: "LB SERVICE",  Icon: Server,   color: "text-violet-400" },
  "ingress":     { label: "INGRESS",     Icon: Network,  color: "text-emerald-400" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function EntryPointRow({ ep }: { ep: GkeEntryPoint }) {
  const meta = TYPE_META[ep.type];

  return (
    <div className="flex items-start gap-3 py-2 px-3 border-b border-slate-800/40 last:border-b-0 hover:bg-white/[0.02] transition-colors">
      {/* Type badge */}
      <div className={cn("shrink-0 flex items-center gap-1 text-[9px] font-bold tracking-widest mt-0.5", meta.color)}>
        <meta.Icon size={11} />
        <span>{meta.label}</span>
      </div>

      {/* IP */}
      <div className="shrink-0 w-36">
        {ep.ip ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-white">{ep.ip}</span>
            {ep.type === "master-api" && (
              <span className="text-[9px] text-slate-500">:443</span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-slate-600 italic">no external IP</span>
        )}
      </div>

      {/* K8s service name */}
      <div className="flex-1 min-w-0">
        {ep.k8sService && (
          <span className="font-mono text-[10px] text-slate-400 truncate block">{ep.k8sService}</span>
        )}
        {ep.lbName && ep.type !== "master-api" && (
          <span className="text-[9px] text-slate-600 truncate block">{ep.lbName}</span>
        )}
      </div>

      {/* Visibility badge */}
      <div className={cn(
        "shrink-0 flex items-center gap-1 text-[9px] px-1.5 py-0.5 border",
        ep.isPublic
          ? "border-amber-800/50 text-amber-500 bg-amber-500/5"
          : "border-slate-700 text-slate-500",
      )}>
        {ep.isPublic
          ? <><ShieldOff size={9} /> PUBLIC</>
          : <><ShieldCheck size={9} /> PRIVATE</>
        }
      </div>
    </div>
  );
}

function ClusterCard({
  clusterName,
  projectId,
  entries,
}: {
  clusterName: string;
  projectId: string;
  entries: GkeEntryPoint[];
}) {
  const [open, setOpen] = useState(true);
  const publicCount = entries.filter(e => e.isPublic).length;

  return (
    <div className="border border-slate-800/60 bg-[#0a0f0a]">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <ChevronRight
          size={12}
          className={cn("text-slate-500 transition-transform shrink-0", open && "rotate-90")}
        />

        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-white font-mono">{clusterName}</span>
          <span className="ml-2 text-[10px] text-slate-500">{projectId}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {publicCount > 0 && (
            <div className="flex items-center gap-1 text-[9px] text-amber-500">
              <AlertTriangle size={10} />
              <span>{publicCount} public</span>
            </div>
          )}
          <span className="text-[10px] text-slate-500">{entries.length} entry point{entries.length !== 1 ? "s" : ""}</span>
        </div>
      </button>

      {/* Entry points list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-slate-800/40"
          >
            {entries.length === 0 ? (
              <p className="px-4 py-3 text-[11px] text-slate-600">No entry points found.</p>
            ) : (
              entries.map((ep, i) => <EntryPointRow key={i} ep={ep} />)
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function EntryPointsPanel() {
  const [entryPoints, setEntryPoints] = useState<GkeEntryPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gcp/cluster-entrypoints");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setEntryPoints(data.entryPoints ?? []);
      setMessage(data.message ?? null);
      setFetched(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Group by cluster
  const byCluster = new Map<string, GkeEntryPoint[]>();
  for (const ep of entryPoints ?? []) {
    const key = `${ep.projectId}/${ep.clusterName}`;
    if (!byCluster.has(key)) byCluster.set(key, []);
    byCluster.get(key)!.push(ep);
  }

  const totalPublic = (entryPoints ?? []).filter(e => e.isPublic).length;

  return (
    <div className="border border-slate-800/60 bg-[#070b07]">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/40">
        <div className="flex items-center gap-3">
          <Network size={14} className="text-emerald-500" />
          <span className="text-xs font-bold tracking-widest uppercase text-white">Cluster Entry Points</span>
          {fetched && totalPublic > 0 && (
            <div className="flex items-center gap-1 text-[9px] text-amber-400 border border-amber-800/40 px-2 py-0.5">
              <AlertTriangle size={9} />
              {totalPublic} publicly exposed
            </div>
          )}
        </div>

        <button
          onClick={load}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase border transition-all",
            loading
              ? "border-slate-700 text-slate-600 cursor-not-allowed"
              : "border-emerald-700 text-emerald-400 hover:bg-emerald-900/20",
          )}
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {fetched ? "REFRESH" : "SCAN ENTRY POINTS"}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-800/30 text-[9px] text-slate-600">
        {Object.entries(TYPE_META).map(([type, meta]) => (
          <div key={type} className={cn("flex items-center gap-1", meta.color)}>
            <meta.Icon size={9} />
            <span>{meta.label}</span>
          </div>
        ))}
        <span className="ml-auto">
          GCP-level discovery — backend services + NEGs + forwarding rules
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {!fetched && !loading && (
          <div className="flex flex-col items-center gap-3 py-8 text-slate-600">
            <Network size={28} className="opacity-30" />
            <p className="text-[11px] text-center max-w-xs">
              Scans GCP backend services, Network Endpoint Groups, and forwarding rules
              to map all external entry points into your GKE clusters.
            </p>
            <button
              onClick={load}
              className="mt-1 px-4 py-2 border border-emerald-700 text-emerald-400 text-[10px] font-bold tracking-widest uppercase hover:bg-emerald-900/20 transition-colors"
            >
              SCAN ENTRY POINTS
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-6 px-2 text-emerald-500">
            <Loader2 size={13} className="animate-spin" />
            <span className="text-[11px]">
              Fetching backend services, NEGs, and forwarding rules…
            </span>
          </div>
        )}

        {error && (
          <div className="border border-red-900/50 bg-red-900/10 p-3 text-red-400 text-[11px]">
            {error}
          </div>
        )}

        {fetched && !loading && byCluster.size === 0 && (
          <p className="py-4 text-[11px] text-slate-500">
            {message ?? "No GKE clusters or GKE-created load balancers found in the last snapshot."}
          </p>
        )}

        {fetched && !loading && byCluster.size > 0 && (
          <div className="flex flex-col gap-3">
            {[...byCluster.entries()].map(([key, entries]) => {
              const [projectId, clusterName] = key.split("/");
              return (
                <ClusterCard
                  key={key}
                  clusterName={clusterName}
                  projectId={projectId}
                  entries={entries}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
