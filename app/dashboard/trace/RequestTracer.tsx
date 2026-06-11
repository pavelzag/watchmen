"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Server, Box, Database, Play, Loader2,
  Cloud, CheckCircle2, XCircle, ChevronDown, RefreshCw,
  ZoomIn, ZoomOut, Maximize2, Minimize2, X, Info, Cpu, Copy, Search, Shield, Activity, Zap, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";
import type { GcpSnapshot, GkeEntryPoint } from "@/lib/gcp/types";
import type { LiveTraceIngressEvent } from "@/lib/live-trace-bus";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 172;
const NODE_H = 68;
const NODE_GAP = 14;
const COL_PADDING_X = 24;
const ROW_PADDING_Y = 40;
const ANIM_COL_DELAY = 320; // ms between columns
const ANIM_PULSE_MS = 260;  // ms node stays "active" before "done"
const LIVE_POLL_ACTIVE_MS = 1500;
const LIVE_POLL_ALL_MS = 4000;
const LIVE_ALL_CLOUD_LOGGING_BATCH_SIZE = 3;
const LIVE_LOG_FETCH_LIMIT = 100;
const LIVE_RPS_WINDOW_MS = 10_000;
const LIVE_STREAM_PULSE_MS = 520;
// Cloud Logging can lag well beyond a few seconds, so keep a wider freshness
// window for "live" traffic while still aging events out of the UI separately.
const LIVE_EVENT_FRESHNESS_MS = 120_000;
const LIVE_EVENT_RETENTION_MS = 120_000;
const LIVE_EVENT_LIMIT = 100;
const LOG_AUTO_REFRESH_MS = 5_000;
const LOG_DRAWER_LIMIT = 200;

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = "internet" | "lb" | "gke" | "cloudrun" | "cloudsql" | "vm" | "sidecar";
type NodeStatus = "idle" | "active" | "done" | "error";
type LiveScope = "active" | "all";
type EndpointFilter = "all" | "compute" | "k8s" | "cloudrun";
type LiveMonitorTarget =
  | {
      kind: "gke";
      projectId: string;
      container: string;
      pathIds: Set<string>;
    }
  | {
      kind: "cloudrun";
      projectId: string;
      service: string;
      region?: string;
      pathIds: Set<string>;
    }
  | {
      kind: "vm";
      projectId: string;
      instance: string;
      region?: string;
      pathIds: Set<string>;
    };

interface LiveEvent {
  id: string;
  ts: string;
  label: string;
  kind: LiveMonitorTarget["kind"];
  projectId: string;
  focusNodeId?: string;
  method?: string;
  path?: string;
  status?: number;
  latency?: string;
  count: number;
}

interface AgentEventRow {
  id: number | string;
  agent_id: string;
  provider?: string;
  project_id?: string;
  cluster_name?: string;
  received_at: string;
  event: {
    type?: string;
    method?: string;
    path?: string;
    status?: number;
    hostname?: string;
    comm?: string;
    data?: string;
  };
}

interface LivePulseBurst {
  id: string;
  pathIds: Set<string>;
}

interface GraphNode {
  id: string;
  type: NodeType;
  col: number;
  label: string;
  sublabel: string;
  projectId?: string;
  region?: string;   // Cloud Run region or GCE zone — used for log filtering
  matchUrl?: string; // Cloud Run URL or LB IP
  resourceName?: string; // Exact service/instance name for log lookups
  container?: string; // sidecar: k8s container name
  parentId?: string;  // sidecar: parent GKE node id
}

interface GraphEdge {
  from: string;
  to: string;
}

interface SvgLine {
  id: string;
  fromId: string;
  toId: string;
  x1: number; y1: number;
  x2: number; y2: number;
}

interface ProxyResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  timing: number;
  body?: string;
  error?: string;
  headers?: Record<string, string>;
}

type TraceSourceMode = "polling" | "streaming";
type GcpComputeTraceSource = "cloud_logging" | "pubsub";
type GcpGkeTraceSource = GcpComputeTraceSource | "ebpf_agent";
type TraceSetupState = "not_configured" | "terraform_generated" | "resources_applied" | "receiving_events";

interface GcpTraceSourceConfigSummary {
  mode: TraceSourceMode;
  computeSource: GcpComputeTraceSource;
  gkeSource: GcpGkeTraceSource;
  setupState: TraceSetupState;
  lastCheckMessage: string;
}

function isPubSubReady(
  demoMode: boolean,
  traceSourceConfig: GcpTraceSourceConfigSummary | null,
): boolean {
  return !demoMode
    && traceSourceConfig?.mode === "streaming"
    && traceSourceConfig.setupState === "receiving_events";
}

function sourceForKind(
  kind: LiveMonitorTarget["kind"],
  traceSourceConfig: GcpTraceSourceConfigSummary | null,
): GcpComputeTraceSource | GcpGkeTraceSource {
  if (kind === "gke") return traceSourceConfig?.gkeSource ?? "cloud_logging";
  return traceSourceConfig?.computeSource ?? "cloud_logging";
}

function shouldUseStreamingLive(
  demoMode: boolean,
  traceSourceConfig: GcpTraceSourceConfigSummary | null,
): boolean {
  return isPubSubReady(demoMode, traceSourceConfig)
    && (traceSourceConfig?.computeSource === "pubsub" || traceSourceConfig?.gkeSource === "pubsub");
}

function shouldPollLiveTarget(
  target: LiveMonitorTarget,
  traceSourceConfig: GcpTraceSourceConfigSummary | null,
): boolean {
  return sourceForKind(target.kind, traceSourceConfig) === "cloud_logging";
}

function shouldUseAgentEvents(traceSourceConfig: GcpTraceSourceConfigSummary | null): boolean {
  return traceSourceConfig?.gkeSource === "ebpf_agent";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function requestIntensityFromRate(rate: number | null): number {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  const normalized = Math.log1p(rate * 1.6) / Math.log1p(36);
  return clamp01(normalized);
}

function estimateRateFromTimestamps(timestamps: number[], nowMs: number, windowMs: number): number | null {
  const recent = timestamps
    .filter(ts => nowMs - ts < windowMs)
    .sort((a, b) => a - b);

  if (recent.length === 0) return null;
  if (recent.length === 1) return 1000 / windowMs;

  const spanMs = Math.max(recent[recent.length - 1] - recent[0], windowMs / 5);
  return recent.length * (1000 / spanMs);
}

function getProxyUrlValidationError(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Enter a valid absolute URL.";
  }

  if (parsed.protocol !== "https:") {
    return "Only HTTPS URLs are allowed by the trace proxy.";
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "169.254.169.254" || host === "metadata.google.internal" || host === "metadata.internal") {
    return "Metadata endpoints are blocked by the trace proxy.";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return "Localhost targets are blocked by the trace proxy.";
  }
  if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) {
    return "Private-network targets are blocked by the trace proxy.";
  }

  return null;
}

function HoverTooltip({
  children,
  content,
  align = "left",
}: {
  children: ReactNode;
  content: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className="group relative min-w-0">
      {children}
      <div
        className={cn(
          "pointer-events-none absolute z-30 top-full mt-2 w-max max-w-[320px] rounded-md border border-emerald-900/50 bg-[#071009]/96 px-3 py-2 text-[9px] leading-relaxed text-slate-200 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-md opacity-0 translate-y-1.5 transition-[opacity,transform] duration-75 group-hover:opacity-100 group-hover:translate-y-0 whitespace-pre-wrap break-words",
          align === "right" ? "right-0" : "left-0"
        )}
      >
        <div
          className={cn(
            "absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-emerald-900/50 bg-[#071009]/96",
            align === "right" ? "right-3" : "left-3"
          )}
        />
        {content}
      </div>
    </div>
  );
}

function TraceActivityRail({
  intensity,
  label,
  rateLabel,
}: {
  intensity: number;
  label: string;
  rateLabel: string;
}) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      setPhase(now / 1000);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const bars = useMemo(() => {
    return Array.from({ length: 24 }, (_, index) => {
      const ripple = (Math.sin(phase * 1.9 + index * 0.45) + 1) / 2;
      const drift = (Math.cos(phase * 0.8 - index * 0.28) + 1) / 2;
      const height = clamp01(0.12 + intensity * (0.32 + ripple * 0.4 + drift * 0.14));
      const opacity = 0.16 + intensity * 0.72;
      return { height, opacity };
    });
  }, [intensity, phase]);

  const headOffset = `${((phase * (0.16 + intensity * 0.42)) % 1) * 100}%`;

  return (
    <div className="shrink-0 border-b border-slate-800/50 bg-[#050805]/90 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0 text-[8px] uppercase tracking-widest text-slate-500">
          <Sparkles size={8} className={intensity > 0.2 ? "text-emerald-400" : "text-slate-600"} />
          {label}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative flex h-5 items-end gap-[2px] overflow-hidden rounded-sm border border-slate-800/80 bg-[#070b07] px-[2px] py-[2px]">
            <div
              className="absolute inset-y-0 w-6 bg-emerald-500/10"
              style={{ left: headOffset }}
            />
            {bars.map((bar, index) => (
              <motion.span
                key={index}
                className="flex-1 origin-bottom rounded-[1px] border border-emerald-950/80 bg-emerald-500/70"
                style={{
                  height: `${Math.max(12, Math.round(bar.height * 100))}%`,
                  opacity: bar.opacity,
                }}
                animate={{
                  scaleY: 0.9 + intensity * 0.45,
                }}
                transition={{
                  duration: 0.18,
                  ease: "easeOut",
                }}
              />
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn(
            "text-[10px] font-mono font-bold leading-none",
            intensity > 0.72 ? "text-red-400" : intensity > 0.42 ? "text-amber-400" : "text-emerald-400"
          )}>
            {rateLabel}
          </div>
          <div className="text-[8px] uppercase tracking-widest text-slate-600">req intensity</div>
        </div>
      </div>
    </div>
  );
}

// ─── Topology builder ─────────────────────────────────────────────────────────

function buildTopology(
  snapshot: GcpSnapshot | null,
  entryPoints: GkeEntryPoint[] = [],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({ id: "internet", type: "internet", col: 0, label: "INTERNET", sublabel: "Entry point" });

  if (!snapshot) {
    nodes.push({ id: "lb-ph", type: "lb", col: 1, label: "LOAD BALANCER", sublabel: "Scan to populate" });
    nodes.push({ id: "compute-ph", type: "gke", col: 2, label: "GKE / CLOUD RUN", sublabel: "Scan to populate" });
    nodes.push({ id: "data-ph", type: "cloudsql", col: 3, label: "CLOUD SQL", sublabel: "Scan to populate" });
    edges.push({ from: "internet", to: "lb-ph" }, { from: "lb-ph", to: "compute-ph" }, { from: "compute-ph", to: "data-ph" });
    return { nodes, edges };
  }

  const lbs  = snapshot.loadBalancers ?? [];
  const gkes = snapshot.gkeClusters ?? [];
  const runs = snapshot.cloudRunServices ?? [];
  const sqls = snapshot.cloudSqlInstances ?? [];
  // VMs: exclude GKE node VMs and stopped instances
  const vms  = (snapshot.vms ?? []).filter(
    v => !v.name.startsWith("gke-") && v.status === "RUNNING"
  );

  // Snapshot load balancers (managed/global LBs from GCP)
  lbs.forEach((lb, i) => {
    const id = `lb-${i}`;
    nodes.push({
      id, type: "lb", col: 1,
      label: lb.name.slice(0, 22).toUpperCase(),
      sublabel: lb.ipAddress ?? lb.type,
      projectId: lb.projectId,
      matchUrl: lb.ipAddress,
    });
    edges.push({ from: "internet", to: id });
  });

  // Entry-point LBs — GKE-created LoadBalancer services not in the snapshot's LB list
  // Keyed by IP so we don't duplicate if two k8s services share the same LB.
  const snapshotLbIps = new Set(lbs.map(l => l.ipAddress).filter(Boolean));
  const epLbNodes = new Map<string, string>(); // ip → node id

  entryPoints
    .filter(ep => ep.type !== "master-api" && ep.ip && !snapshotLbIps.has(ep.ip))
    .forEach(ep => {
      if (epLbNodes.has(ep.ip!)) return; // already added this IP
      const id = `ep-lb-${ep.ip!.replace(/\./g, "-")}`;
      const svcLabel = ep.k8sService ? ep.k8sService.split("/").pop()! : ep.clusterName;
      nodes.push({
        id, type: "lb", col: 1,
        label: svcLabel.slice(0, 22).toUpperCase(),
        sublabel: ep.ip!,
        projectId: ep.projectId,
        matchUrl: ep.ip,
      });
      edges.push({ from: "internet", to: id });
      epLbNodes.set(ep.ip!, id);
    });

  const allLbNodes = nodes.filter(n => n.type === "lb");
  const hasLbs = allLbNodes.length > 0;

  // GKE clusters
  gkes.forEach((cluster, i) => {
    const id = `gke-${i}`;
    nodes.push({
      id, type: "gke", col: 2,
      label: cluster.name.slice(0, 22).toUpperCase(),
      sublabel: `GKE · ${cluster.location}`,
      projectId: cluster.projectId,
    });

    // Connect snapshot LBs in same project
    const parentSnapshotLbs = lbs
      .map((lb, li) => ({ lb, id: `lb-${li}` }))
      .filter(({ lb }) => lb.projectId === cluster.projectId);
    parentSnapshotLbs.forEach(({ id: lbId }) => edges.push({ from: lbId, to: id }));

    // Connect entry-point LBs that belong to this cluster
    entryPoints
      .filter(ep => ep.clusterName === cluster.name && ep.projectId === cluster.projectId && ep.ip && epLbNodes.has(ep.ip))
      .forEach(ep => {
        const lbId = epLbNodes.get(ep.ip!)!;
        if (!edges.find(e => e.from === lbId && e.to === id)) {
          edges.push({ from: lbId, to: id });
        }
      });

    // Fallback: if still no parent LB found, connect directly to internet.
    // Don't guess which LB — attaching to an unrelated one creates false edges.
    const hasParent = edges.some(e => e.to === id);
    if (!hasParent) edges.push({ from: "internet", to: id });
  });

  // Cloud Run services — always directly from internet.
  // Cloud Run has its own *.run.app URL and is NOT behind a GCP external LB
  // unless a custom domain + serverless NEG is explicitly configured.
  // Connecting it to snapshot LBs (which front GKE/VMs) would create false edges
  // and cause Cloud Run to light up when sending requests to the GKE cluster.
  runs.forEach((svc, i) => {
    const id = `run-${i}`;
    nodes.push({
      id, type: "cloudrun", col: 2,
      label: svc.name.slice(0, 22).toUpperCase(),
      sublabel: `Cloud Run · ${svc.region}`,
      projectId: svc.projectId,
      region: svc.region,
      matchUrl: svc.url,
      resourceName: svc.name,
    });
    edges.push({ from: "internet", to: id });
  });

  // Compute Engine VMs (non-GKE, RUNNING)
  vms.forEach((vm, i) => {
    const id = `vm-${i}`;
    const zone = vm.zone.split("/").pop() ?? vm.zone;
    nodes.push({
      id, type: "vm", col: 2,
      label: vm.name.slice(0, 22).toUpperCase(),
      sublabel: `VM · ${zone}`,
      projectId: vm.projectId,
      region: zone,
      matchUrl: vm.externalIp ?? undefined,
      resourceName: vm.name,
    });
    const parentLbs = lbs
      .map((lb, li) => ({ lb, id: `lb-${li}` }))
      .filter(({ lb }) => lb.projectId === vm.projectId);
    if (parentLbs.length > 0) {
      parentLbs.forEach(({ id: lbId }) => edges.push({ from: lbId, to: id }));
    } else {
      edges.push({ from: "internet", to: id });
    }
  });

  // Cloud SQL
  sqls.forEach((db, i) => {
    const id = `sql-${i}`;
    nodes.push({
      id, type: "cloudsql", col: 3,
      label: db.name.slice(0, 22).toUpperCase(),
      sublabel: `${db.databaseVersion} · ${db.region}`,
      projectId: db.projectId,
    });
    const computeInProject = nodes.filter(n =>
      (n.type === "gke" || n.type === "cloudrun" || n.type === "vm") && n.projectId === db.projectId
    );
    if (computeInProject.length > 0) {
      computeInProject.forEach(c => edges.push({ from: c.id, to: id }));
    }
  });

  return { nodes, edges };
}

// ─── Path inference ───────────────────────────────────────────────────────────

function inferActivePath(url: string, nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const active = new Set<string>(["internet"]);
  if (!url) return active;

  const target = url.toLowerCase().replace(/^https?:\/\//, "").split(/[/:]/)[0];

  // Match any node whose matchUrl prefix or exact IP matches the URL
  const matched = nodes.find(n => {
    if (!n.matchUrl) return false;
    const mu = n.matchUrl.replace(/^https?:\/\//, "").split(/[/:]/)[0];
    return target === mu || url.startsWith(n.matchUrl);
  });

  if (matched) {
    const addDownstream = (id: string) => {
      if (active.has(id)) return;
      active.add(id);
      edges.filter(e => e.from === id).forEach(e => addDownstream(e.to));
    };
    const addUpstream = (id: string) => {
      edges.filter(e => e.to === id).forEach(e => { active.add(e.from); addUpstream(e.from); });
    };
    addDownstream(matched.id);
    addUpstream(matched.id);
  }
  // No match → only "internet" stays active (unknown path, don't light up unrelated nodes)

  return active;
}

function buildPathForNode(nodeId: string, edges: GraphEdge[]): Set<string> {
  const path = new Set<string>(["internet"]);
  const addDownstream = (id: string) => {
    if (path.has(id)) return;
    path.add(id);
    edges.filter(e => e.from === id).forEach(e => addDownstream(e.to));
  };
  const addUpstream = (id: string) => {
    edges.filter(e => e.to === id).forEach(e => {
      path.add(e.from);
      addUpstream(e.from);
    });
  };
  addDownstream(nodeId);
  addUpstream(nodeId);
  return path;
}

function liveTargetKey(target: LiveMonitorTarget): string {
  if (target.kind === "gke") return `gke:${target.projectId}:${target.container}`;
  if (target.kind === "cloudrun") return `cloudrun:${target.projectId}:${target.region ?? ""}:${target.service}`;
  return `vm:${target.projectId}:${target.region ?? ""}:${target.instance}`;
}

function buildLiveLogParams(target: LiveMonitorTarget, after: string): URLSearchParams {
  const params = new URLSearchParams({
    projectId: target.projectId,
    after,
    limit: String(LIVE_LOG_FETCH_LIMIT),
  });
  if (target.kind === "gke") {
    params.set("container", target.container);
  } else if (target.kind === "cloudrun") {
    params.set("resourceType", "cloud_run_revision");
    params.set("service", target.service);
    if (target.region) params.set("region", target.region);
  } else if (target.kind === "vm") {
    params.set("resourceType", "gce_instance");
    params.set("instance", target.instance);
    if (target.region) params.set("region", target.region);
  }
  return params;
}

function liveTargetLabel(target: LiveMonitorTarget): string {
  if (target.kind === "gke") return target.container === "ebpf-agent" ? "GKE · eBPF agent" : `GKE · ${target.container}`;
  if (target.kind === "cloudrun") return `RUN · ${target.service}`;
  return `VM · ${target.instance}`;
}

function resolveTargetFromIngressEvent(event: LiveTraceIngressEvent): {
  kind: LiveMonitorTarget["kind"];
  projectId: string;
  region?: string;
  service?: string;
  instance?: string;
  container?: string;
} {
  if (event.kind === "cloudrun") {
    return {
      kind: "cloudrun",
      projectId: event.projectId,
      region: event.region,
      service: event.resourceName,
    };
  }
  if (event.kind === "vm") {
    return {
      kind: "vm",
      projectId: event.projectId,
      region: event.region,
      instance: event.resourceName,
    };
  }
  return {
    kind: "gke",
    projectId: event.projectId,
    region: event.region,
    container: event.container ?? event.resourceName,
  };
}

function liveTargetKeyFromIngressEvent(event: LiveTraceIngressEvent): string {
  const target = resolveTargetFromIngressEvent(event);
  if (target.kind === "cloudrun") return `cloudrun:${target.projectId}:${target.region ?? ""}:${target.service}`;
  if (target.kind === "vm") return `vm:${target.projectId}:${target.region ?? ""}:${target.instance}`;
  return `gke:${target.projectId}:${target.container}`;
}

function ingressEventMatchesLiveTarget(event: LiveTraceIngressEvent, target: LiveMonitorTarget): boolean {
  if (event.kind !== target.kind || event.projectId !== target.projectId) return false;
  if (target.kind === "gke") return true;
  return liveTargetKeyFromIngressEvent(event) === liveTargetKey(target);
}

function resolveLiveTargetNodeId(target: LiveMonitorTarget, nodes: GraphNode[]): string | undefined {
  if (target.kind === "gke") {
    return nodes.find(
      n => target.pathIds.has(n.id) && n.type === "sidecar" && n.projectId === target.projectId && n.container === target.container
    )?.id ?? nodes.find(
      n => target.pathIds.has(n.id) && n.type === "gke" && n.projectId === target.projectId
    )?.id;
  }
  if (target.kind === "cloudrun") {
    return nodes.find(
      n => target.pathIds.has(n.id) && n.type === "cloudrun" && n.projectId === target.projectId && n.resourceName === target.service
    )?.id;
  }
  return nodes.find(
    n => target.pathIds.has(n.id) && n.type === "vm" && n.projectId === target.projectId && n.resourceName === target.instance
  )?.id;
}

function resolveLiveEventNodeIdFromIngress(event: LiveTraceIngressEvent, nodes: GraphNode[]): string | undefined {
  const target = resolveTargetFromIngressEvent(event);
  if (target.kind === "cloudrun") {
    return nodes.find(
      n => n.type === "cloudrun" && n.projectId === target.projectId && n.resourceName === target.service
    )?.id;
  }
  if (target.kind === "vm") {
    return nodes.find(
      n => n.type === "vm" && n.projectId === target.projectId && n.resourceName === target.instance
    )?.id;
  }
  return nodes.find(
    n => n.type === "sidecar" && n.projectId === target.projectId && n.container === target.container
  )?.id ?? nodes.find(
    n => n.type === "gke" && n.projectId === target.projectId
  )?.id;
}

function buildPathForIngressEvent(
  event: LiveTraceIngressEvent,
  nodes: GraphNode[],
  edges: GraphEdge[],
  activeTarget: LiveMonitorTarget | null,
): Set<string> | null {
  const focusNodeId = resolveLiveEventNodeIdFromIngress(event, nodes);
  if (focusNodeId) return buildPathForNode(focusNodeId, edges);
  if (activeTarget && ingressEventMatchesLiveTarget(event, activeTarget)) {
    return new Set(activeTarget.pathIds);
  }
  const fallbackNode = nodes.find(node => {
    if (node.projectId !== event.projectId) return false;
    if (event.kind === "gke") return node.type === "gke";
    if (event.kind === "cloudrun") return node.type === "cloudrun" && node.resourceName === event.resourceName;
    return node.type === "vm" && node.resourceName === event.resourceName;
  });
  return fallbackNode ? buildPathForNode(fallbackNode.id, edges) : null;
}

function toLiveEventFromIngress(event: LiveTraceIngressEvent, nodes: GraphNode[]): LiveEvent {
  const target = resolveTargetFromIngressEvent(event);
  return {
    id: event.id,
    ts: event.timestamp,
    label: target.kind === "cloudrun"
      ? `RUN · ${target.service}`
      : target.kind === "vm"
        ? `VM · ${target.instance}`
        : `GKE · ${target.container}`,
    kind: target.kind,
    projectId: target.projectId,
    focusNodeId: resolveLiveEventNodeIdFromIngress(event, nodes),
    method: event.method,
    path: event.path,
    status: event.status,
    latency: event.latency,
    count: event.count,
  };
}

function resolveAgentEventNodeId(event: AgentEventRow, nodes: GraphNode[]): string | undefined {
  return nodes.find(
    n => n.type === "gke" && (!event.project_id || n.projectId === event.project_id)
  )?.id ?? nodes.find(n => n.type === "gke")?.id;
}

function buildPathForAgentEvent(
  event: AgentEventRow,
  nodes: GraphNode[],
  edges: GraphEdge[],
  activeTarget: LiveMonitorTarget | null,
): Set<string> | null {
  if (
    activeTarget?.kind === "gke"
    && (!event.project_id || activeTarget.projectId === event.project_id)
  ) {
    return new Set(activeTarget.pathIds);
  }
  const focusNodeId = resolveAgentEventNodeId(event, nodes);
  return focusNodeId ? buildPathForNode(focusNodeId, edges) : null;
}

function toLiveEventFromAgentEvent(event: AgentEventRow, nodes: GraphNode[]): LiveEvent {
  const focusNodeId = resolveAgentEventNodeId(event, nodes);
  const ev = event.event ?? {};
  return {
    id: `agent:${event.id}`,
    ts: event.received_at,
    label: event.cluster_name
      ? `GKE · ${event.cluster_name}`
      : `GKE · ${ev.hostname ?? event.agent_id}`,
    kind: "gke",
    projectId: event.project_id ?? "",
    focusNodeId,
    method: ev.method,
    path: ev.path,
    status: ev.status,
    count: 1,
  };
}

interface ParsedLiveRequestLog {
  entry: LogEntry;
  method?: string;
  path?: string;
  status?: number;
  latency?: string;
  userAgent?: string;
}

const EXPECTED_REQUEST_PATHS = new Set([
  "/health",
  "/api/health",
  "/healthz",
  "/ready",
  "/readyz",
  "/live",
  "/livez",
  "/startup",
  "/startupz",
  "/ping",
  "/metrics",
]);

const DEFAULT_HIDDEN_GKE_HEALTH_PATHS = new Set([
  "/health",
  "/api/health",
  "/healthz",
]);

const EXPECTED_REQUEST_USER_AGENT_RE = /\b(GoogleHC|kube-probe|ELB-HealthChecker|HealthChecker|watchmen-trace-poller)\b/i;

function isExpectedLiveRequest({
  path,
  userAgent,
}: {
  path?: string;
  userAgent?: string;
}): boolean {
  const cleanPath = (path ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  if (EXPECTED_REQUEST_PATHS.has(cleanPath.toLowerCase())) return true;
  if (EXPECTED_REQUEST_USER_AGENT_RE.test(userAgent ?? "")) return true;
  if ((path ?? "").includes("watchmen_trace_probe=")) return true;
  return false;
}

function extractHeaderValue(raw: unknown, headerName: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const headerRe = new RegExp(`^${headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "im");
  return raw.match(headerRe)?.[1]?.trim();
}

function isExpectedAgentLiveEvent(event: AgentEventRow): boolean {
  const ev = event.event ?? {};
  if (ev.type !== "http_request") return true;
  return isExpectedLiveRequest({
    path: ev.path,
    userAgent: extractHeaderValue(ev.data, "User-Agent"),
  });
}

function parseLiveRequestLog(entry: LogEntry): ParsedLiveRequestLog | null {
  if (entry.httpRequest) {
    const hr = entry.httpRequest;
    const method = hr.method || undefined;
    const path = hr.url
      ? (() => {
          try { return new URL(hr.url).pathname; }
          catch { return hr.url; }
        })()
      : undefined;
    if (!method && !path && hr.status === undefined) return null;
    return {
      entry,
      method,
      path,
      status: hr.status,
      latency: hr.latency || undefined,
      userAgent: hr.userAgent || undefined,
    };
  }

  const parsed =
    parseReqLog(entry.message) ??
    parseNginxLog(entry.message) ??
    parseEnvoyLog(entry.message) ??
    parseTraceAppLog(entry.message) ??
    parseStructuredRequestLog(entry.message);

  if (!parsed?.method && !parsed?.path) return null;

  return {
    entry,
    method: parsed.method || undefined,
    path: parsed.path || undefined,
    status: parsed.status || undefined,
    latency: `${parsed.latencyMs}ms`,
    userAgent: ("userAgent" in parsed ? parsed.userAgent : undefined) || undefined,
  };
}

function getLiveRequestLogs(entries: LogEntry[], includeExpectedRequests: boolean): ParsedLiveRequestLog[] {
  return entries
    .map(parseLiveRequestLog)
    .filter((entry): entry is ParsedLiveRequestLog => !!entry && (includeExpectedRequests || !isExpectedLiveRequest(entry)));
}

function toLiveEvents(
  target: LiveMonitorTarget,
  entries: LogEntry[],
  nodes: GraphNode[],
  includeExpectedRequests: boolean,
): LiveEvent[] {
  const requestLogs = getLiveRequestLogs(entries, includeExpectedRequests)
    .sort((a, b) => eventTimestampMs(b.entry.timestamp) - eventTimestampMs(a.entry.timestamp));
  const label = liveTargetLabel(target);
  const focusNodeId = resolveLiveTargetNodeId(target, nodes);
  const targetKey = liveTargetKey(target);

  return requestLogs.slice(0, 20).map((request, index) => ({
    id: `${targetKey}:${request.entry.timestamp}:${request.method ?? "HTTP"}:${request.path ?? "request"}:${index}`,
    ts: request.entry.timestamp,
    label,
    kind: target.kind,
    projectId: target.projectId,
    focusNodeId,
    method: request.method,
    path: request.path,
    status: request.status,
    latency: request.latency,
    count: 1,
  }));
}

function toDemoLiveEvent(target: LiveMonitorTarget, ts: string, count: number, nodes: GraphNode[]): LiveEvent {
  const method = Math.random() < 0.8 ? "GET" : "POST";
  const paths = ["/", "/healthz", "/index", "/api/trace", "/api/status"];
  const path = paths[Math.floor(Math.random() * paths.length)];
  const statuses = [200, 200, 200, 201, 202, 403, 404, 500];
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  const latencyMs = 20 + Math.floor(Math.random() * 900);
  return {
    id: `${liveTargetKey(target)}:${ts}:${count}:demo`,
    ts,
    label: liveTargetLabel(target),
    kind: target.kind,
    projectId: target.projectId,
    focusNodeId: resolveLiveTargetNodeId(target, nodes),
    method,
    path,
    status,
    latency: `${latencyMs}ms`,
    count,
  };
}

function eventTimestampMs(ts: string | undefined): number {
  if (!ts) return 0;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function buildRouteToNode(nodeId: string, edges: GraphEdge[]): string[] {
  const path: string[] = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const parent = edges.find(edge => edge.to === id);
    if (parent) visit(parent.from);
    path.push(id);
  };

  visit(nodeId);
  return path;
}

function liveEventStatusHint(event: LiveEvent): string {
  if (event.status === undefined) return "Request observed, but the log line did not expose an HTTP status.";
  if (event.status >= 500) return "5xx usually means the workload handled the request but failed while processing it or talking to an upstream dependency.";
  if (event.status === 404) return "404 suggests the request reached the service, but the application route was not registered for that path.";
  if (event.status === 403) return "403 usually means the request hit the workload, but auth, ingress policy, or app-level authorization blocked it.";
  if (event.status >= 400) return "4xx means the service received the request and rejected it before completing the intended application flow.";
  if (event.status >= 300) return "3xx indicates the request was accepted and redirected elsewhere.";
  return "2xx indicates the request reached the target workload and completed successfully.";
}

function activeTargetNodeFromPath(pathIds: Set<string>, nodes: GraphNode[]): GraphNode | null {
  return (
    nodes.find(node => pathIds.has(node.id) && node.type === "sidecar") ??
    nodes.find(node => pathIds.has(node.id) && node.type === "cloudrun") ??
    nodes.find(node => pathIds.has(node.id) && node.type === "vm") ??
    nodes.find(node => pathIds.has(node.id) && node.type === "gke") ??
    null
  );
}

function LiveEventDetail({
  event,
  nodes,
  edges,
  onClose,
  onSelectNode,
}: {
  event: LiveEvent;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
}) {
  const focusNode = event.focusNodeId ? nodes.find(node => node.id === event.focusNodeId) ?? null : null;
  const routeIds = event.focusNodeId ? buildRouteToNode(event.focusNodeId, edges) : [];
  const routeNodes = routeIds
    .map(routeId => nodes.find(node => node.id === routeId) ?? null)
    .filter((node): node is GraphNode => !!node);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="flex h-[min(78vh,760px)] w-[min(760px,100%)] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700/70 bg-[#070b07]/96 shadow-2xl shadow-black/60"
        style={{ fontFamily: "var(--font-mono, monospace)" }}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-800/40 px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Observed Request</div>
            <div className="mt-1 text-[11px] text-emerald-400 font-semibold">{event.label}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm border border-slate-800 px-2 py-1 text-[9px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Timestamp</div>
              <div className="mt-1 text-slate-200">{new Date(event.ts).toLocaleString()}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Project</div>
              <div className="mt-1 text-slate-200 break-all">{event.projectId}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Request</div>
              <div className="mt-1 text-slate-200">
                <span className={cn("font-bold mr-2", event.method ? (METHOD_COLOR[event.method] ?? "text-slate-300") : "text-slate-300")}>
                  {event.method ?? "LOG"}
                </span>
                <span className="break-all">{event.path ?? "Request observed"}</span>
              </div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Outcome</div>
              <div className="mt-1 text-slate-200">
                {event.status !== undefined ? (
                  <span className={cn("font-bold mr-2", statusColor(event.status))}>{event.status}</span>
                ) : null}
                <span>{event.latency ?? "Latency not exposed"}</span>
                {event.count > 1 ? <span className="text-slate-500"> · burst of {event.count}</span> : null}
              </div>
            </div>
          </div>

          <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Inferred Route</div>
            {routeNodes.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                {routeNodes.map((node, index) => (
                  <div key={`${event.id}-${node.id}`} className="contents">
                    {index > 0 && <span className="text-slate-700">→</span>}
                    <button
                      onClick={() => onSelectNode(node)}
                      className="border border-slate-700/70 bg-[#09110b] px-2 py-1 text-slate-200 transition-colors hover:border-emerald-700/70 hover:text-emerald-300"
                    >
                      {node.label}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-slate-500">No route could be inferred for this log entry.</p>
            )}
            {focusNode && (
              <p className="mt-2 text-[10px] text-slate-500">
                Final observed workload: <span className="text-slate-300">{focusNode.label}</span>
                {focusNode.sublabel ? <span className="text-slate-600"> · {focusNode.sublabel}</span> : null}
              </p>
            )}
          </div>

          <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Interpretation</div>
            <p className="mt-2 text-[10px] text-slate-300">{liveEventStatusHint(event)}</p>
            <div className="mt-2 text-[10px] text-slate-500">
              Useful next checks: inspect the final node logs, compare the path against discovered routes, and verify whether auth or ingress policy matches the status you saw.
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Layout calculation ───────────────────────────────────────────────────────

function calcPositions(
  nodes: GraphNode[],
  containerW: number,
  containerH: number,
): Record<string, { cx: number; cy: number }> {
  const maxCol = Math.max(...nodes.map(n => n.col), 0);
  const numCols = maxCol + 1;
  const colWidth = containerW / numCols;

  const pos: Record<string, { cx: number; cy: number }> = {};

  for (let col = 0; col < numCols; col++) {
    const colNodes = nodes.filter(n => n.col === col);
    const totalH = colNodes.length * NODE_H + (colNodes.length - 1) * NODE_GAP;
    const startY = containerH / 2 - totalH / 2;

    colNodes.forEach((node, idx) => {
      pos[node.id] = {
        cx: COL_PADDING_X + colWidth * col + colWidth / 2,
        cy: ROW_PADDING_Y + startY + idx * (NODE_H + NODE_GAP) + NODE_H / 2,
      };
    });
  }

  return pos;
}

function calcFocusedPathPositions(
  nodes: GraphNode[],
  activeIds: Set<string>,
  containerW: number,
  containerH: number,
): Record<string, { cx: number; cy: number }> {
  const activeNodes = nodes.filter(node => activeIds.has(node.id));
  if (activeNodes.length <= 1) return {};

  const cols = [...new Set(activeNodes.map(node => node.col))].sort((a, b) => a - b);
  const focusedGap = 44;
  const totalW = cols.length * NODE_W + Math.max(0, cols.length - 1) * focusedGap;
  const startX = containerW / 2 - totalW / 2 + NODE_W / 2;
  const colIndex = new Map(cols.map((col, index) => [col, index]));
  const pos: Record<string, { cx: number; cy: number }> = {};

  for (const col of cols) {
    const colNodes = activeNodes.filter(node => node.col === col);
    const totalH = colNodes.length * NODE_H + (colNodes.length - 1) * NODE_GAP;
    const startY = containerH / 2 - totalH / 2;
    const index = colIndex.get(col) ?? 0;

    colNodes.forEach((node, nodeIdx) => {
      pos[node.id] = {
        cx: startX + index * (NODE_W + focusedGap),
        cy: ROW_PADDING_Y + startY + nodeIdx * (NODE_H + NODE_GAP) + NODE_H / 2,
      };
    });
  }

  return pos;
}

function buildSvgLines(
  edges: GraphEdge[],
  pos: Record<string, { cx: number; cy: number }>,
): SvgLine[] {
  return edges.map(e => {
    const from = pos[e.from];
    const to = pos[e.to];
    if (!from || !to) return null;
    // Same-column edges (sidecar chains): draw bottom-center → top-center
    const sameCol = Math.abs(from.cx - to.cx) < 4;
    return {
      id: `${e.from}__${e.to}`,
      fromId: e.from,
      toId: e.to,
      x1: sameCol ? from.cx : from.cx + NODE_W / 2,
      y1: sameCol ? from.cy + NODE_H / 2 : from.cy,
      x2: sameCol ? to.cx : to.cx - NODE_W / 2,
      y2: sameCol ? to.cy - NODE_H / 2 : to.cy,
    };
  }).filter((l): l is SvgLine => l !== null);
}

function bezierPath(l: SvgLine): string {
  const cp = Math.abs(l.x2 - l.x1) * 0.5;
  return `M ${l.x1},${l.y1} C ${l.x1 + cp},${l.y1} ${l.x2 - cp},${l.y2} ${l.x2},${l.y2}`;
}

// ─── Node icon + color ────────────────────────────────────────────────────────

const NODE_META: Record<NodeType, { Icon: any; border: string; text: string; glow: string }> = {
  internet: { Icon: Globe,         border: "border-sky-700",     text: "text-sky-400",     glow: "shadow-sky-500/20" },
  lb:       { Icon: Server,        border: "border-violet-700",  text: "text-violet-400",  glow: "shadow-violet-500/20" },
  gke:      { Icon: Box,           border: "border-emerald-700", text: "text-emerald-400", glow: "shadow-emerald-500/20" },
  cloudrun: { Icon: Cloud,         border: "border-emerald-700", text: "text-emerald-400", glow: "shadow-emerald-500/20" },
  cloudsql: { Icon: Database,      border: "border-amber-700",   text: "text-amber-400",   glow: "shadow-amber-500/20" },
  vm:       { Icon: Cpu,           border: "border-cyan-700",    text: "text-cyan-400",    glow: "shadow-cyan-500/20" },
  sidecar:  { Icon: Box,           border: "border-slate-700",   text: "text-slate-400",   glow: "shadow-slate-500/20" },
};

// Per-container icon/color for sidecar nodes
function getContainerMeta(name: string): { Icon: any; border: string; text: string } {
  if (name === "nginx")       return { Icon: Server, border: "border-orange-700",  text: "text-orange-400" };
  if (name === "istio-proxy") return { Icon: Shield, border: "border-violet-700",  text: "text-violet-400" };
  return                             { Icon: Box,    border: "border-teal-700",    text: "text-teal-400"   };
}

// Canonical sidecar processing order: network interceptors first, then app containers
const SIDECAR_ORDER = ["istio-proxy", "nginx"];
function sidecarSortKey(name: string): string {
  const idx = SIDECAR_ORDER.indexOf(name);
  return idx >= 0 ? String(idx).padStart(3, "0") : `999-${name}`;
}

const STATUS_OVERLAY: Record<NodeStatus, string> = {
  idle:   "border-slate-800 bg-[#0d0d0d]",
  active: "border-emerald-400 bg-[#021a08] shadow-lg shadow-emerald-500/30",
  done:   "border-emerald-700 bg-[#011205]",
  error:  "border-red-700 bg-[#1a0505]",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function tryParseJson(s: string): { ok: true; val: any } | { ok: false } {
  try { return { ok: true, val: JSON.parse(s) }; } catch { return { ok: false }; }
}

function statusColor(code: number | undefined) {
  if (!code) return "text-slate-400";
  if (code < 300) return "text-emerald-400";
  if (code < 400) return "text-sky-400";
  if (code < 500) return "text-amber-400";
  return "text-red-400";
}

// ─── Component ────────────────────────────────────────────────────────────────

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const LOG_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] as const;
type LogMethodFilter = "all" | typeof LOG_METHODS[number];
const METHOD_COLOR: Record<string, string> = {
  GET: "text-sky-400", POST: "text-emerald-400", PUT: "text-amber-400",
  PATCH: "text-orange-400", DELETE: "text-red-400",
  HEAD: "text-cyan-400", OPTIONS: "text-violet-400", TRACE: "text-fuchsia-400",
};

function requestPriority(method?: string, path?: string): number {
  const normalized = (method ?? "").toUpperCase();
  if (normalized && normalized !== "GET") return 0;
  if ((path ?? "").includes("watchmen_trace_probe=")) return 1;
  return 2;
}

const ENDPOINT_FILTERS: { id: EndpointFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "compute", label: "Compute" },
  { id: "k8s", label: "K8s" },
  { id: "cloudrun", label: "CloudRun" },
];

// ─── Node type labels ─────────────────────────────────────────────────────────

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  internet:  "Internet Entry",
  lb:        "Load Balancer",
  gke:       "GKE Cluster",
  cloudrun:  "Cloud Run",
  cloudsql:  "Cloud SQL",
  vm:        "Compute Engine VM",
  sidecar:   "Sidecar Container",
};

const NODE_ROLE_DESC: Record<NodeType, string> = {
  internet:  "Origin of the outgoing HTTP request.",
  lb:        "GCP external load balancer that forwards traffic to backend services.",
  gke:       "Google Kubernetes Engine cluster running containerised workloads.",
  cloudrun:  "Serverless Cloud Run service — the request is delivered directly here.",
  cloudsql:  "Managed relational database — not reachable via HTTP, accessed internally.",
  vm:        "Compute Engine VM instance — direct or LB-fronted HTTP workload.",
  sidecar:   "Sidecar container injected alongside the main app in the same pod.",
};

// ─── TraceModal sub-component ─────────────────────────────────────────────────

const CONTAINER_COLORS: Record<string, string> = {
  nginx:         "text-orange-400",
  "istio-proxy": "text-violet-400",
};
function containerColor(name: string) { return CONTAINER_COLORS[name] ?? "text-teal-400"; }

function TraceModal({
  requestTime, nodeContainers, gkeNodes, onClose,
}: {
  requestTime: Date;
  nodeContainers: Record<string, string[]>;
  gkeNodes: GraphNode[];
  onClose: () => void;
}) {
  type TraceEntry = LogEntry & { containerName: string; nodeLabel: string };
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const after  = new Date(requestTime.getTime() - 30000).toISOString();
    const before = new Date(requestTime.getTime() + 30000).toISOString();

    const fetches: Promise<void>[] = [];
    const all: TraceEntry[] = [];

    for (const node of gkeNodes) {
      const containers = nodeContainers[node.id] ?? [];
      for (const cname of containers) {
        const params = new URLSearchParams({
          projectId: node.projectId!, container: cname, after, before, limit: "50",
        });
        fetches.push(
          fetch(`/api/gcp/logs?${params}`)
            .then(r => r.json())
            .then(d => {
              (d.entries ?? []).forEach((e: LogEntry) => {
                all.push({ ...e, containerName: cname, nodeLabel: node.label });
              });
            })
            .catch(() => {})
        );
      }
    }

    Promise.all(fetches)
      .then(() => {
        all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        setEntries(all);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const MCOLOR: Record<string, string> = {
    GET: "text-sky-400", POST: "text-emerald-400", PUT: "text-amber-400",
    PATCH: "text-orange-400", DELETE: "text-red-400",
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.15 }}
        className="bg-[#0a0a0a] border border-slate-800 w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 shrink-0">
          <Activity size={11} className="text-emerald-400 shrink-0" />
          <span className="text-[9px] uppercase tracking-widest text-slate-400 flex-1">
            Request Trace · {requestTime.toLocaleTimeString()} ±30s
          </span>
          {!loading && (
            <span className="text-[8px] text-slate-600">{entries.length} events</span>
          )}
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300"><X size={11} /></button>
        </div>

        {/* Legend */}
        {!loading && entries.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-1.5 border-b border-slate-800/50 shrink-0">
            {[...new Set(entries.map(e => e.containerName))].map(c => (
              <span key={c} className={cn("text-[8px] font-mono flex items-center gap-1", containerColor(c))}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "currentColor" }} />
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        {loading && (
          <div className="flex items-center gap-2 p-4 text-emerald-500 text-[10px]">
            <Loader2 size={10} className="animate-spin" /> Fetching trace data…
          </div>
        )}
        {error && (
          <div className="p-4 text-red-400 text-[10px]">{error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="p-4 text-slate-600 text-[10px]">No logs found within ±30s of the request.</div>
        )}
        {!loading && entries.length > 0 && (
          <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-0.5 font-mono text-[10px]">
            {entries.map((e, i) => {
              const ts = e.timestamp
                ? new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "";
              const parsed = !e.httpRequest
                ? (parseReqLog(e.message) ?? parseNginxLog(e.message) ?? parseEnvoyLog(e.message) ?? parseTraceAppLog(e.message))
                : null;
              const method = e.httpRequest?.method ?? parsed?.method ?? "";
              const path = e.httpRequest
                ? (() => { try { return new URL(e.httpRequest!.url).pathname; } catch { return e.httpRequest!.url; } })()
                : parsed?.path ?? "";
              const status = e.httpRequest?.status ?? parsed?.status;
              const statusC = !status ? "" : status < 300 ? "text-emerald-400" : status < 400 ? "text-sky-400" : status < 500 ? "text-amber-400" : "text-red-400";
              const latency = e.httpRequest?.latency ?? (parsed ? `${parsed.latencyMs}ms` : "");

              return (
                <div key={i} className="flex items-baseline gap-2 border-b border-slate-800/20 pb-0.5 last:border-0">
                  <span className="text-slate-700 shrink-0 w-20">{ts}</span>
                  <span className={cn("shrink-0 w-24 truncate text-[8px]", containerColor(e.containerName))}>{e.containerName}</span>
                  {method ? (
                    <>
                      <span className={cn("shrink-0 w-10 font-bold", MCOLOR[method] ?? "text-slate-400")}>{method}</span>
                      {status !== undefined && <span className={cn("shrink-0 w-8", statusC)}>{status}</span>}
                      <span className="text-white flex-1 truncate">{path}</span>
                      {latency && <span className="text-slate-700 shrink-0">{latency}</span>}
                    </>
                  ) : (
                    <span className="text-slate-500 flex-1 truncate">{e.message}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── ResponseDetail sub-component ────────────────────────────────────────────

function ResponseDetail({
  response,
  open,
  onToggleHeaders,
  method,
  url,
  routeNodes,
  onSelectNode,
}: {
  response: ProxyResponse;
  open: boolean;
  onToggleHeaders: () => void;
  method: string;
  url: string;
  routeNodes: GraphNode[];
  onSelectNode: (node: GraphNode) => void;
}) {
  const [showContext, setShowContext] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => setShowContext(v => !v)}
        className="flex flex-col gap-1 border border-slate-800 p-2 bg-[#0d0d0d] text-left transition-colors hover:border-emerald-900/60"
      >
        <div className="flex justify-between">
          <span className="text-slate-500">Status</span>
          <span className={cn("font-bold", statusColor(response.status))}>
            {response.status ?? "—"} {response.statusText}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Timing</span>
          <span className={cn(
            response.timing < 200 ? "text-emerald-400" :
            response.timing < 1000 ? "text-amber-400" : "text-red-400"
          )}>{response.timing}ms</span>
        </div>
        <div className="pt-1 text-[9px] text-slate-600">
          {showContext ? "Hide route and response context" : "Click to inspect route and response context"}
        </div>
      </button>

      {showContext && (
        <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5 space-y-3">
          <div>
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Request</div>
            <div className="mt-1 text-[10px] text-slate-200 break-all">
              <span className={cn("font-bold mr-2", METHOD_COLOR[method] ?? "text-slate-300")}>{method}</span>
              <span>{url}</span>
            </div>
          </div>

          <div>
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Inferred Route</div>
            {routeNodes.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                {routeNodes.map((node, index) => (
                  <div key={`response-route-${node.id}`} className="contents">
                    {index > 0 && <span className="text-slate-700">→</span>}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectNode(node);
                      }}
                      className="border border-slate-700/70 bg-[#09110b] px-2 py-1 text-slate-200 transition-colors hover:border-emerald-700/70 hover:text-emerald-300"
                    >
                      {node.label}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-slate-500">No route could be inferred for this response.</p>
            )}
          </div>

          <div>
            <div className="text-[8px] uppercase tracking-widest text-slate-600">Interpretation</div>
            <p className="mt-2 text-[10px] text-slate-300">
              {response.status
                ? response.status >= 500
                  ? "The request appears to have reached the final workload, but the workload or an upstream dependency failed while processing it."
                  : response.status >= 400
                    ? "The request reached the target service, but the service rejected it. This usually means auth, validation, or route policy stopped it."
                    : "The request appears to have traversed the inferred path and completed successfully at the final workload."
                : "The request did not produce a normal HTTP response. Check the route nodes and logs for transport or proxy failures."}
            </p>
          </div>
        </div>
      )}

      {response.error && (
        <div className="border border-red-900/50 bg-red-900/10 p-2 text-red-400 text-[10px]">
          {response.error}
        </div>
      )}

      {response.headers && Object.keys(response.headers).length > 0 && (
        <div>
          <button
            onClick={onToggleHeaders}
            className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-500 hover:text-slate-300 mb-1"
          >
            <ChevronDown size={10} className={cn("transition-transform", open && "rotate-180")} />
            Headers
          </button>
          {open && (
            <div className="border border-slate-800 p-2 bg-[#0a0a0a] flex flex-col gap-0.5 max-h-32 overflow-y-auto">
              {Object.entries(response.headers).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[9px]">
                  <span className="text-slate-500 shrink-0 truncate max-w-[90px]">{k}</span>
                  <span className="text-slate-300 truncate">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {response.body && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Body</div>
          <pre className="border border-slate-800 p-2 bg-[#0a0a0a] text-[10px] text-slate-300 overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {(() => {
              const p = tryParseJson(response.body);
              return p.ok ? JSON.stringify(p.val, null, 2) : response.body;
            })()}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── NodeDetail sub-component ─────────────────────────────────────────────────

// Parse wm-echo text logs: "[req] IP  METHOD PATH  →  STATUS  (Xms)  [body=...]"
const REQ_LOG_RE = /\[req\]\s+(\S+)\s+(\S+)\s+(\S+)\s+→\s+(\d+)\s+\((\d+)ms\)(?:\s+body=(.+))?/;
function parseReqLog(msg: string): { ip: string; method: string; path: string; status: number; latencyMs: number; body?: string } | null {
  const m = msg.match(REQ_LOG_RE);
  if (!m) return null;
  return { ip: m[1], method: m[2], path: m[3], status: Number(m[4]), latencyMs: Number(m[5]), body: m[6] };
}

// Parse Istio/Envoy access log text format:
// [2026-03-29T...] "GET /path HTTP/1.1" 200 - 0 1234 5 3 "1.2.3.4" "curl/7.x" "req-id" "host" "upstream"
const ENVOY_LOG_RE = /\[(\S+)\]\s+"(\w+)\s+(\S+)\s+HTTP\/[\d.]+" (\d+) \S+ \d+ \d+ (\d+) \d+ "([^"]*)" "([^"]*)"/;
function parseEnvoyLog(msg: string): { method: string; path: string; status: number; latencyMs: number; remoteIp: string; userAgent: string } | null {
  const m = msg.match(ENVOY_LOG_RE);
  if (!m) return null;
  return { method: m[2], path: m[3], status: Number(m[4]), latencyMs: Number(m[5]), remoteIp: m[6], userAgent: m[7] };
}

const TRACE_APP_LOG_RE = /\bservice=(\S+)\s+method=(\S+)\s+path=(\S+)\s+remote=(\S+)\s+duration=(\S+)/;
function durationToMs(value: string): number {
  const m = value.match(/^([\d.]+)(ns|µs|us|ms|s)$/);
  if (!m) return 0;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return 0;
  switch (m[2]) {
    case "ns": return amount / 1_000_000;
    case "µs":
    case "us": return amount / 1_000;
    case "s": return amount * 1_000;
    default: return amount;
  }
}
function parseTraceAppLog(msg: string): { method: string; path: string; status: number; latencyMs: number; remoteIp: string; userAgent: string; service: string } | null {
  const m = msg.match(TRACE_APP_LOG_RE);
  if (!m) return null;
  return {
    service: m[1],
    method: m[2],
    path: m[3],
    remoteIp: m[4],
    latencyMs: durationToMs(m[5]),
    status: 200,
    userAgent: "",
  };
}

// Parse nginx JSON access logs: {"time":...,"remote_addr":...,"method":...,"uri":...,"status":200,...}
function parseNginxLog(msg: string): { method: string; path: string; status: number; latencyMs: number; remoteIp: string; userAgent: string } | null {
	try {
		const j = JSON.parse(msg);
    if (!j.method && !j.uri) return null;
    return {
      method:    j.method ?? "",
      path:      j.uri ?? "",
      status:    Number(j.status ?? 0),
      latencyMs: j.request_time ? Math.round(Number(j.request_time) * 1000) : 0,
      remoteIp:  j.remote_addr ?? j.x_forwarded_for ?? "",
		userAgent: j.user_agent ?? "",
	};
  } catch { return null; }
}

function parseStructuredRequestLog(msg: string): {
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  remoteIp: string;
  userAgent: string;
  headers?: Record<string, unknown>;
  body?: string;
} | null {
  try {
    const j = JSON.parse(msg);
    if (j?.type !== "request" || !j.method || !j.path) return null;
    return {
      method: j.method,
      path: j.path,
      status: Number(j.status ?? 0),
      latencyMs: Number(j.latencyMs ?? 0),
      remoteIp: j.remoteIp ?? "",
      userAgent: (j.headers?.["User-Agent"] as string) ?? (j.headers?.["user-agent"] as string) ?? "",
      headers: j.headers ?? undefined,
      body: typeof j.body === "string" ? j.body : undefined,
    };
  } catch {
    return null;
  }
}

type NodeDetailTab = "info" | "logs" | "routes";

interface DiscoveredRoute { method: string; path: string; description?: string; body?: Record<string, string> | null; }
interface HttpRequestLog {
  method: string; url: string; status?: number;
  latency: string;
  requestSize?: string;
  remoteIp: string;
  serverIp?: string;
  referer?: string;
  responseSize: string;
  userAgent: string;
  protocol?: string;
}
interface LogEntry {
  timestamp: string; severity: string; message: string;
  pod?: string; container?: string; revision?: string; instanceId?: string;
  httpRequest?: HttpRequestLog;
  payload?: unknown;
}

interface LogEntryDetails {
  title: string;
  timestamp: string;
  method?: string;
  path?: string;
  status?: number;
  latency?: string;
  remoteIp?: string;
  responseSize?: string;
  requestSize?: string;
  userAgent?: string;
  serverIp?: string;
  referer?: string;
  protocol?: string;
  source?: string;
  severity?: string;
  message?: string;
  body?: string;
  headers?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  traceId?: string;
  traceSource?: string;
  traceMethod?: string;
  contentType?: string;
  payloadBytes?: string;
  payload?: unknown;
}

interface CapturedHttpDetails {
  method?: string;
  path?: string;
  protocol?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findStructuredRequestPayload(payload: unknown): {
  headers?: Record<string, unknown>;
  body?: unknown;
} {
  const root = asRecord(payload);
  if (!root) return {};

  const directHeaders = asRecord(root.headers);
  const directBody = root.body ?? root.payload ?? root.requestBody;
  if (directHeaders || directBody !== undefined) {
    return { headers: directHeaders ?? undefined, body: directBody };
  }

  const request = asRecord(root.request);
  if (request) {
    const requestHeaders = asRecord(request.headers);
    const requestBody = request.body ?? request.payload;
    if (requestHeaders || requestBody !== undefined) {
      return { headers: requestHeaders ?? undefined, body: requestBody };
    }
  }

  const httpRequest = asRecord(root.httpRequest);
  if (httpRequest) {
    const requestHeaders = asRecord(httpRequest.headers);
    const requestBody = httpRequest.body;
    if (requestHeaders || requestBody !== undefined) {
      return { headers: requestHeaders ?? undefined, body: requestBody };
    }
  }

  return {};
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const foundKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  const value = foundKey ? headers[foundKey] : undefined;
  return typeof value === "string" ? value : value === undefined ? undefined : String(value);
}

function parseQueryParams(pathOrUrl: string | undefined): Record<string, string> | undefined {
  if (!pathOrUrl) return undefined;
  try {
    const url = new URL(pathOrUrl, "http://watchmen.local");
    const entries = [...url.searchParams.entries()];
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

function parseCapturedHttpDetails(raw: string | undefined): CapturedHttpDetails | null {
  if (!raw) return null;
  const normalized = raw.replace(/\r\n/g, "\n");
  const [head, ...bodyParts] = normalized.split(/\n\n/);
  const lines = head.split("\n").filter(Boolean);
  const firstLine = lines[0] ?? "";
  const headers: Record<string, string> = {};

  lines.slice(1).forEach(line => {
    const idx = line.indexOf(":");
    if (idx <= 0) return;
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });

  const request = firstLine.match(/^([A-Z]+)\s+(\S+)\s+(HTTP\/\d(?:\.\d)?)$/);
  const response = firstLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/);
  if (!request && !response && Object.keys(headers).length === 0) return null;

  return {
    method: request?.[1],
    path: request?.[2],
    protocol: request?.[3],
    status: response ? Number(response[1]) : undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: bodyParts.join("\n\n") || undefined,
  };
}

function withCapturedHttpDetails(details: LogEntryDetails, raw: string | undefined): LogEntryDetails {
  const captured = parseCapturedHttpDetails(raw);
  const headers = {
    ...(captured?.headers ?? {}),
    ...(details.headers ?? {}),
  };
  const mergedHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  const queryParams = details.queryParams ?? parseQueryParams(details.path) ?? parseQueryParams(captured?.path);
  const traceId =
    details.traceId ??
    headerValue(mergedHeaders, "X-Watchmen-Trace-Id") ??
    queryParams?.watchmen_trace_probe;

  return {
    ...details,
    method: details.method ?? captured?.method,
    path: details.path ?? captured?.path,
    protocol: details.protocol ?? captured?.protocol,
    status: details.status ?? captured?.status,
    userAgent: details.userAgent ?? headerValue(mergedHeaders, "User-Agent"),
    body: details.body ?? captured?.body,
    headers: mergedHeaders,
    queryParams,
    traceId,
    traceSource: details.traceSource ?? headerValue(mergedHeaders, "X-Watchmen-Trace-Source"),
    traceMethod: details.traceMethod ?? headerValue(mergedHeaders, "X-Watchmen-Trace-Method"),
    contentType: details.contentType ?? headerValue(mergedHeaders, "Content-Type"),
    payloadBytes: details.payloadBytes ?? headerValue(mergedHeaders, "X-Watchmen-Payload-Bytes"),
  };
}

function getLogEntryDetails(entry: LogEntry): LogEntryDetails {
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Unknown";
  const structured = findStructuredRequestPayload(entry.payload);
  const structuredBody = structured.body !== undefined
    ? typeof structured.body === "string"
      ? structured.body
      : JSON.stringify(structured.body, null, 2)
    : undefined;

  if (entry.httpRequest) {
    const hr = entry.httpRequest;
    const path = (() => { try { return new URL(hr.url).pathname; } catch { return hr.url; } })();
    return withCapturedHttpDetails({
      title: `${hr.method} ${path}`,
      timestamp: ts,
      method: hr.method,
      path,
      status: hr.status,
      latency: hr.latency,
      requestSize: hr.requestSize ? `${hr.requestSize}B` : undefined,
      remoteIp: hr.remoteIp,
      serverIp: hr.serverIp || undefined,
      referer: hr.referer || undefined,
      responseSize: hr.responseSize ? `${hr.responseSize}B` : undefined,
      userAgent: hr.userAgent,
      protocol: hr.protocol || undefined,
      message: entry.message || undefined,
      source: entry.revision || entry.pod || entry.instanceId || undefined,
      headers: structured.headers,
      queryParams: parseQueryParams(hr.url),
      body: structuredBody,
      payload: entry.payload,
    }, entry.message);
  }

  const parsed = parseReqLog(entry.message) ?? parseNginxLog(entry.message) ?? parseEnvoyLog(entry.message) ?? parseTraceAppLog(entry.message);
  if (parsed) {
    const source = entry.container || entry.pod || entry.instanceId || entry.revision || "";
    const remoteIp = (parsed as any).ip ?? (parsed as any).remoteIp ?? "";
    const body = (parsed as any).body ?? "";
    const userAgent = (parsed as any).userAgent ?? "";
    return withCapturedHttpDetails({
      title: `${parsed.method} ${parsed.path}`,
      timestamp: ts,
      method: parsed.method,
      path: parsed.path,
      status: parsed.status,
      latency: `${parsed.latencyMs}ms`,
      remoteIp: remoteIp || undefined,
      userAgent: userAgent || undefined,
      source: source || undefined,
      body: body || structuredBody,
      headers: structured.headers,
      message: entry.message,
      payload: entry.payload,
    }, entry.message);
  }

  const structuredLog = parseStructuredRequestLog(entry.message);
  if (structuredLog) {
    const source = entry.container || entry.pod || entry.instanceId || entry.revision || "";
    return withCapturedHttpDetails({
      title: `${structuredLog.method} ${structuredLog.path}`,
      timestamp: ts,
      method: structuredLog.method,
      path: structuredLog.path,
      status: structuredLog.status,
      latency: `${structuredLog.latencyMs}ms`,
      remoteIp: structuredLog.remoteIp || undefined,
      userAgent: structuredLog.userAgent || undefined,
      source: source || undefined,
      body: structuredLog.body || structuredBody,
      headers: structuredLog.headers ?? structured.headers,
      message: entry.message,
      payload: entry.payload,
    }, entry.message);
  }

  return withCapturedHttpDetails({
    title: entry.severity || "Log entry",
    timestamp: ts,
    severity: entry.severity,
    source: entry.revision || entry.pod || entry.instanceId || undefined,
    message: entry.message,
    body: structuredBody,
    headers: structured.headers,
    payload: entry.payload,
  }, entry.message);
}

function getLogEntryRequestPath(entry: LogEntry): string | undefined {
  if (entry.httpRequest?.url) {
    try { return new URL(entry.httpRequest.url).pathname; }
    catch { return entry.httpRequest.url; }
  }

  const parsed =
    parseReqLog(entry.message) ??
    parseStructuredRequestLog(entry.message) ??
    parseNginxLog(entry.message) ??
    parseEnvoyLog(entry.message) ??
    parseTraceAppLog(entry.message);
  return parsed?.path;
}

function isDefaultHiddenGkeHealthLog(entry: LogEntry): boolean {
  const cleanPath = (getLogEntryRequestPath(entry) ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  return DEFAULT_HIDDEN_GKE_HEALTH_PATHS.has(cleanPath.toLowerCase());
}

function LogEntryModal({
  entry,
  onClose,
}: {
  entry: LogEntry;
  onClose: () => void;
}) {
  const details = getLogEntryDetails(entry);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="flex w-[min(760px,100%)] max-h-[80vh] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700/70 bg-[#070b07]/96 shadow-2xl shadow-black/60"
        style={{ fontFamily: "var(--font-mono, monospace)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/40 px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Log Entry</div>
            <div className="mt-1 text-[11px] text-emerald-400 font-semibold break-all">{details.title}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm border border-slate-800 px-2 py-1 text-[9px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3 text-[10px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Timestamp</div>
              <div className="mt-1 text-slate-200">{details.timestamp}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Source</div>
              <div className="mt-1 text-slate-200 break-all">{details.source ?? "Unknown"}</div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Request</div>
              <div className="mt-1 text-slate-200 break-all">
                {details.method ? <span className={cn("font-bold mr-2", METHOD_COLOR[details.method] ?? "text-slate-300")}>{details.method}</span> : null}
                <span>{details.path ?? details.message ?? "Log entry"}</span>
              </div>
            </div>
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Outcome</div>
              <div className="mt-1 text-slate-200">
                {details.status !== undefined ? <span className={cn("font-bold mr-2", statusColor(details.status))}>{details.status}</span> : null}
                <span>{details.latency ?? details.severity ?? "No status/latency"}</span>
              </div>
            </div>
          </div>

          {details.headers && Object.keys(details.headers).length > 0 && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Headers</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">
                {JSON.stringify(details.headers, null, 2)}
              </pre>
            </div>
          )}

          {(details.traceId || details.traceSource || details.traceMethod || details.contentType || details.payloadBytes) && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Trace Probe</div>
              <div className="mt-2 grid gap-1 text-slate-300 sm:grid-cols-2">
                {details.traceId ? <div className="break-all"><span className="text-slate-500">Trace ID:</span> {details.traceId}</div> : null}
                {details.traceSource ? <div className="break-all"><span className="text-slate-500">Source:</span> {details.traceSource}</div> : null}
                {details.traceMethod ? <div><span className="text-slate-500">Declared method:</span> {details.traceMethod}</div> : null}
                {details.contentType ? <div className="break-all"><span className="text-slate-500">Content type:</span> {details.contentType}</div> : null}
                {details.payloadBytes ? <div><span className="text-slate-500">Payload bytes:</span> {details.payloadBytes}</div> : null}
              </div>
            </div>
          )}

          {details.queryParams && Object.keys(details.queryParams).length > 0 && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Query Parameters</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">
                {JSON.stringify(details.queryParams, null, 2)}
              </pre>
            </div>
          )}

          {Boolean(details.payload) && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Structured Payload</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">
                {JSON.stringify(details.payload, null, 2)}
              </pre>
            </div>
          )}

          {(details.method || details.path || details.protocol || details.requestSize || details.remoteIp || details.serverIp || details.referer || details.responseSize || details.userAgent) && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Request Details</div>
              <div className="mt-2 space-y-1 text-slate-300">
                {details.method ? <div><span className="text-slate-500">Method:</span> {details.method}</div> : null}
                {details.path ? <div className="break-all"><span className="text-slate-500">Path:</span> {details.path}</div> : null}
                {details.protocol ? <div><span className="text-slate-500">Protocol:</span> {details.protocol}</div> : null}
                {details.requestSize ? <div><span className="text-slate-500">Request size:</span> {details.requestSize}</div> : null}
                {details.responseSize ? <div><span className="text-slate-500">Response size:</span> {details.responseSize}</div> : null}
                {details.remoteIp ? <div><span className="text-slate-500">Caller IP:</span> {details.remoteIp}</div> : null}
                {details.serverIp ? <div><span className="text-slate-500">Server IP:</span> {details.serverIp}</div> : null}
                {details.referer ? <div className="break-all"><span className="text-slate-500">Referer:</span> {details.referer}</div> : null}
                {details.userAgent ? <div className="break-all"><span className="text-slate-500">User agent:</span> {details.userAgent}</div> : null}
              </div>
            </div>
          )}

          {details.body && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Body</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{details.body}</pre>
            </div>
          )}

          {details.message && (
            <div className="border border-slate-800/60 bg-[#0a0d0a] px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-slate-600">Raw Log</div>
              <pre className="mt-2 whitespace-pre-wrap break-all text-slate-300">{details.message}</pre>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function NodeDetail({
  node, status, inPath, response, url, method, onClose, onIstioDetected,
}: {
  node: GraphNode; status: NodeStatus; inPath: boolean;
  response: ProxyResponse | null; url: string; method: string; onClose: () => void;
  onIstioDetected?: (nodeId: string) => void;
}) {
  const meta = node.type === "sidecar" && node.container
    ? { ...NODE_META.sidecar, ...getContainerMeta(node.container) }
    : NODE_META[node.type];
  const isTerminal = (node.type === "cloudrun" || node.type === "gke") &&
    inPath && node.matchUrl && url.startsWith(node.matchUrl ?? "~~");
  const isErrorNode = status === "error";

  const statusLabel =
    status === "active" ? "IN FLIGHT" : status === "done" ? "OK" :
    status === "error" ? "FAILED HERE" : inPath ? "IN PATH" : "NOT IN PATH";
  const statusLabelColor =
    status === "active" ? "text-emerald-400 border-emerald-800" :
    status === "done" ? "text-emerald-400 border-emerald-800" :
    status === "error" ? "text-red-400 border-red-900" :
    inPath ? "text-slate-400 border-slate-700" : "text-slate-600 border-slate-800";

  // Tabs — only nodes that have their own logs/routes get the tab bar.
  // LBs are infrastructure (no container logs); they only get routes if matchUrl is set.
  const hasLogs   = node.type === "gke" || node.type === "cloudrun" || node.type === "vm" || node.type === "sidecar";
  const hasRoutes = node.type === "gke" || node.type === "cloudrun" || node.type === "lb" || node.type === "vm";
  const showTabs  = hasLogs || hasRoutes;
  const [tab, setTab] = useState<NodeDetailTab>("info");

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState<"all" | "2xx" | "3xx" | "4xx" | "5xx">("all");
  const [logMethodFilter, setLogMethodFilter] = useState<LogMethodFilter>("all");
  const [hideGkeHealthLogs, setHideGkeHealthLogs] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [selectedLogEntry, setSelectedLogEntry] = useState<LogEntry | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>(
    node.type === "sidecar" ? (node.container ?? "") : ""
  );

  // Routes state
  const [routes, setRoutes] = useState<DiscoveredRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routesSource, setRoutesSource] = useState<string | null>(null);

  // Fetch available containers for GKE and sidecar nodes (for the container selector)
  useEffect(() => {
    if (tab !== "logs" || !node.projectId) return;
    if (node.type !== "gke" && node.type !== "sidecar") return;
    const params = new URLSearchParams({ projectId: node.projectId, mode: "containers" });
    fetch(`/api/gcp/logs?${params}`)
      .then(r => r.json())
      .then(d => {
        const containers: string[] = d.containers ?? [];
        setAvailableContainers(containers);
        if (containers.includes("istio-proxy")) onIstioDetected?.(node.id);
      })
      .catch(() => {});
  }, [tab, node.id, node.projectId, node.type, onIstioDetected]);

  const refreshLogs = useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    if (!node.projectId) return;
    if (showLoading) setLoadingLogs(true);
    setLogsError(null);
    const params = new URLSearchParams({ projectId: node.projectId, limit: String(LOG_DRAWER_LIMIT) });
    if (node.type === "cloudrun") {
      params.set("resourceType", "cloud_run_revision");
      params.set("service", node.resourceName ?? node.label.toLowerCase());
      if (node.region) params.set("region", node.region);
    } else if (node.type === "vm") {
      params.set("resourceType", "gce_instance");
      params.set("instance", node.resourceName ?? node.label.toLowerCase());
      if (node.region) params.set("region", node.region);
    } else if (node.type === "sidecar") {
      params.set("resourceType", "k8s_container");
      params.set("container", selectedContainer || (node.container ?? ""));
    } else {
      params.set("resourceType", "k8s_container");
      if (selectedContainer) {
        params.set("container", selectedContainer);
      } else {
        // Exclude the watchmen app itself — show only service containers
        params.set("excludeContainer", "watchmen");
      }
    }

    try {
      const res = await fetch(`/api/gcp/logs?${params}`);
      const d = await res.json();
      if (d.error) { setLogsError(d.error); return; }
      setLogs(d.entries ?? []);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : "Failed to fetch logs.");
    } finally {
      if (showLoading) setLoadingLogs(false);
    }
  }, [node.projectId, node.type, node.resourceName, node.label, node.region, node.container, selectedContainer]);

  // Fetch logs when tab or container selection changes, then keep them fresh while visible.
  useEffect(() => {
    if (tab !== "logs" || !node.projectId) return;
    refreshLogs({ showLoading: true });
    const intervalId = window.setInterval(() => {
      refreshLogs();
    }, LOG_AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [tab, node.projectId, refreshLogs]);

  // Fetch routes when tab becomes active
  useEffect(() => {
    if (tab !== "routes" || !node.matchUrl) return;
    setLoadingRoutes(true);
    const base = node.matchUrl.startsWith("http") ? node.matchUrl : `http://${node.matchUrl}`;
    fetch(`/api/app-routes?url=${encodeURIComponent(base)}`)
      .then(r => r.json())
      .then(d => { setRoutes(d.routes ?? []); setRoutesSource(d.discoveredFrom); })
      .catch(() => {})
      .finally(() => setLoadingRoutes(false));
  }, [tab, node.matchUrl]);

  // Filtered logs
  const canHideGkeHealthLogs = node.type === "gke" || node.type === "sidecar";
  const hiddenGkeHealthLogCount = useMemo(
    () => canHideGkeHealthLogs ? logs.filter(isDefaultHiddenGkeHealthLog).length : 0,
    [canHideGkeHealthLogs, logs]
  );
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (canHideGkeHealthLogs && hideGkeHealthLogs && isDefaultHiddenGkeHealthLog(l)) return false;
      const parsed = !l.httpRequest ? (parseReqLog(l.message) ?? parseStructuredRequestLog(l.message) ?? parseNginxLog(l.message) ?? parseEnvoyLog(l.message) ?? parseTraceAppLog(l.message)) : null;
      const status = l.httpRequest?.status ?? parsed?.status;
      const method = (l.httpRequest?.method ?? parsed?.method ?? "").toUpperCase();
      const searchable = l.httpRequest
        ? `${l.httpRequest.method} ${l.httpRequest.url} ${l.httpRequest.remoteIp} ${l.httpRequest.userAgent}`
        : parsed
        ? `${parsed.method} ${parsed.path} ${(parsed as any).ip ?? (parsed as any).remoteIp ?? ""} ${(parsed as any).userAgent ?? ""} ${(parsed as any).body ?? ""} ${JSON.stringify((parsed as any).headers ?? {})}`
        : l.message;

      if (logStatusFilter !== "all") {
        if (status === undefined) return false;
        const ranges: Record<string, [number, number]> = { "2xx": [200, 299], "3xx": [300, 399], "4xx": [400, 499], "5xx": [500, 599] };
        const r = ranges[logStatusFilter];
        if (r && (status < r[0] || status > r[1])) return false;
      }
      if (logMethodFilter !== "all" && method !== logMethodFilter) return false;
      if (logSearch.trim()) {
        if (!searchable.toLowerCase().includes(logSearch.toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) => {
      const aParsed = !a.httpRequest ? (parseReqLog(a.message) ?? parseStructuredRequestLog(a.message) ?? parseNginxLog(a.message) ?? parseEnvoyLog(a.message) ?? parseTraceAppLog(a.message)) : null;
      const bParsed = !b.httpRequest ? (parseReqLog(b.message) ?? parseStructuredRequestLog(b.message) ?? parseNginxLog(b.message) ?? parseEnvoyLog(b.message) ?? parseTraceAppLog(b.message)) : null;
      const aMethod = a.httpRequest?.method ?? aParsed?.method;
      const bMethod = b.httpRequest?.method ?? bParsed?.method;
      const aPath = a.httpRequest
        ? (() => { try { return new URL(a.httpRequest!.url).pathname; } catch { return a.httpRequest!.url; } })()
        : aParsed?.path;
      const bPath = b.httpRequest
        ? (() => { try { return new URL(b.httpRequest!.url).pathname; } catch { return b.httpRequest!.url; } })()
        : bParsed?.path;
      const prio = requestPriority(aMethod, aPath) - requestPriority(bMethod, bPath);
      if (prio !== 0) return prio;
      return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
    });
  }, [canHideGkeHealthLogs, hideGkeHealthLogs, logs, logMethodFilter, logSearch, logStatusFilter]);

  // Copy logs to clipboard
  const handleCopyLogs = useCallback(() => {
    const text = filteredLogs.map(l => {
      const ts = l.timestamp ? new Date(l.timestamp).toISOString() : "";
      if (l.httpRequest) {
        const hr = l.httpRequest;
        return `${ts}  ${hr.method}  ${hr.status ?? "?"}  ${hr.url}  ${hr.remoteIp}  ${hr.latency}`;
      }
      const parsed = parseReqLog(l.message) ?? parseTraceAppLog(l.message);
      if (parsed) {
        return `${ts}  ${parsed.method}  ${parsed.status}  ${parsed.path}  ${(parsed as any).ip ?? (parsed as any).remoteIp ?? ""}  ${parsed.latencyMs}ms${(parsed as any).body ? `  body=${(parsed as any).body}` : ""}`;
      }
      return `${ts}  ${l.severity}  ${l.message}`;
    }).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    });
  }, [filteredLogs]);

  // Keyboard: C = copy, Escape = close expand
  useEffect(() => {
    if (tab !== "logs") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "c" && !e.ctrlKey && !e.metaKey) handleCopyLogs();
      if (e.key === "Escape") {
        if (selectedLogEntry) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedLogEntry(null);
          return;
        }
        if (logsExpanded) {
          e.preventDefault();
          e.stopPropagation();
          setLogsExpanded(false);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tab, handleCopyLogs, selectedLogEntry, logsExpanded]);

  // AI analysis state
  const [aiState, setAiState] = useState<{ loading: boolean; text: string | null; error: string | null }>({ loading: false, text: null, error: null });
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");

  async function askAI(question?: string) {
    if (!filteredLogs.length) return;
    setAiState({ loading: true, text: null, error: null });
    setAiOpen(true);
    try {
      const browserAI = getActiveBrowserAIKey();
      const res = await fetch("/api/logs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logs: filteredLogs,
          nodeLabel: node.label,
          nodeType: node.type,
          container: selectedContainer || node.container,
          question: question?.trim() || undefined,
          demoCredentials: browserAI ? { aiKey: browserAI.key, aiProvider: browserAI.provider } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setAiState({ loading: false, text: data.analysis, error: null });
    } catch (e) {
      setAiState({ loading: false, text: null, error: e instanceof Error ? e.message : "Error" });
    }
  }

  function renderAiMd(text: string): string {
    const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escapeHtml(text)
      .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
        `<pre class="bg-[#0d0d0d] border border-slate-800 px-2 py-1.5 text-[9px] font-mono text-slate-300 overflow-x-auto my-1.5 whitespace-pre-wrap">${code}</pre>`
      )
      .replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-slate-800 text-sky-300 text-[9px] font-mono">$1</code>')
      .replace(/^### (.+)$/gm, '<p class="text-[9px] font-semibold text-slate-300 uppercase tracking-wider mt-2.5 mb-0.5">$1</p>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-200">$1</strong>')
      .replace(/^[-*] (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
      .replace(/(<li[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class="space-y-0.5 my-1">${m}</ul>`)
      .replace(/\n(?!<)/g, "<br />");
  }

  const METHOD_COLOR: Record<string, string> = {
    GET: "text-sky-400", POST: "text-emerald-400", PUT: "text-amber-400",
    PATCH: "text-orange-400", DELETE: "text-red-400",
    HEAD: "text-cyan-400", OPTIONS: "text-violet-400", TRACE: "text-fuchsia-400",
  };

  return (
    <>
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-slate-800/50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <meta.Icon size={12} className={meta.text} />
          <span className="text-[10px] uppercase tracking-widest text-slate-300 truncate">{node.label}</span>
        </div>
        <button onClick={onClose} className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Tab bar */}
      {showTabs && (
        <div className="shrink-0 flex border-b border-slate-800/50">
          {(["info", ...(hasLogs ? ["logs"] : []), ...(hasRoutes ? ["routes"] : [])] as NodeDetailTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-1.5 text-[9px] uppercase tracking-widest transition-colors border-b-2 -mb-px",
                tab === t ? "border-emerald-600 text-emerald-400" : "border-transparent text-slate-600 hover:text-slate-400"
              )}
            >{t}</button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 text-[11px]">

        {/* ── INFO tab ── */}
        {tab === "info" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-slate-600">{NODE_TYPE_LABEL[node.type]}</span>
              <span className={cn("text-[8px] font-bold border px-1.5 py-0.5", statusLabelColor)}>{statusLabel}</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">{NODE_ROLE_DESC[node.type]}</p>
            <div className="border border-slate-800 bg-[#0d0d0d] divide-y divide-slate-800">
              <MetaRow label="Name" value={node.label} mono />
              {node.sublabel && <MetaRow label="Info" value={node.sublabel} />}
              {node.projectId && <MetaRow label="Project" value={node.projectId} mono />}
              {node.matchUrl && <MetaRow label="Address" value={node.matchUrl} mono />}
              {availableContainers.length > 0 && (
                <MetaRow label="Containers" value={availableContainers.join(", ")} mono />
              )}
              {availableContainers.includes("istio-proxy") && (
                <MetaRow label="Service Mesh" value="Istio · mTLS enabled" />
              )}
            </div>

            {(status !== "idle" || response) && (
              <div className="flex flex-col gap-2">
                <div className="text-[9px] uppercase tracking-widest text-slate-600">Request Context</div>
                {node.type === "internet" && (
                  <div className="border border-slate-800 bg-[#0d0d0d] divide-y divide-slate-800">
                    <MetaRow label="Method" value={method} mono />
                    <MetaRow label="URL" value={url} mono />
                  </div>
                )}
                {(node.type === "lb" || node.type === "gke" || node.type === "cloudrun" || node.type === "vm") && inPath && (
                  <div className="border border-slate-800 bg-[#0d0d0d] divide-y divide-slate-800">
                    {node.type === "lb" && <MetaRow label="Role" value="Forwarded request to backend" />}
                    {node.type === "gke" && !isTerminal && <MetaRow label="Role" value="Backend cluster for this LB" />}
                    {isTerminal && response && (
                      <>
                        <MetaRow label="Role" value="Received the HTTP request" />
                        <MetaRow label="Status" value={response.status ? `${response.status} ${response.statusText}` : "—"} mono />
                        <MetaRow label="Timing" value={`${response.timing}ms`} mono />
                      </>
                    )}
                  </div>
                )}
                {node.type === "cloudsql" && (
                  <p className="text-[10px] text-slate-600 italic">Accessed internally by your application — not via HTTP.</p>
                )}
                {isErrorNode && response?.error && (
                  <div className="border border-red-900/40 bg-red-900/10 p-2 text-red-400 text-[10px]">
                    <div className="text-[9px] uppercase tracking-widest text-red-700 mb-1">Error</div>
                    {response.error}
                  </div>
                )}
                {isTerminal && response?.body && (
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Response Body</div>
                    <pre className="border border-slate-800 p-2 bg-[#0a0a0a] text-[10px] text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                      {(() => { const p = tryParseJson(response.body!); return p.ok ? JSON.stringify(p.val, null, 2) : response.body; })()}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {status === "idle" && !response && (
              <div className="flex items-start gap-2 text-[10px] text-slate-600">
                <Info size={10} className="shrink-0 mt-0.5" />
                <span>Send a request to see how traffic flows through this node.</span>
              </div>
            )}
          </>
        )}

        {/* ── LOGS tab ── */}
        {tab === "logs" && (
          <>
            {/* Header row */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-slate-600 flex-1 truncate">Cloud Logging · {node.projectId}</span>
              <button
                onClick={handleCopyLogs}
                title="Copy logs (C)"
                className={cn("transition-colors", copyFlash ? "text-emerald-400" : "text-slate-600 hover:text-slate-300")}
              ><Copy size={9} /></button>
              <button
                onClick={() => setLogsExpanded(v => !v)}
                title="Expand logs"
                className="text-slate-600 hover:text-slate-300 transition-colors"
              ><Maximize2 size={9} /></button>
              <button
                onClick={() => refreshLogs({ showLoading: true })}
                title="Refresh"
                className="text-slate-600 hover:text-slate-300 transition-colors"
              ><RefreshCw size={9} className={loadingLogs ? "animate-spin" : ""} /></button>
            </div>

            {/* Container selector (GKE + sidecar nodes) */}
            {(node.type === "gke" || node.type === "sidecar") && availableContainers.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {node.type === "gke" && (
                  <button
                    onClick={() => setSelectedContainer("")}
                    className={cn("text-[8px] px-1.5 py-0.5 border transition-colors",
                      !selectedContainer ? "border-slate-500 text-slate-300 bg-slate-800" : "border-slate-800 text-slate-600 hover:text-slate-400"
                    )}>ALL</button>
                )}
                {availableContainers.map(c => (
                  <button
                    key={c}
                    onClick={() => setSelectedContainer(c)}
                    className={cn("text-[8px] px-1.5 py-0.5 border transition-colors font-mono",
                      selectedContainer === c ? "border-emerald-700 text-emerald-400 bg-emerald-900/20" : "border-slate-800 text-slate-600 hover:text-slate-400"
                    )}>{c}</button>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search size={8} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
              <input
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder="Search logs…"
                className="w-full bg-[#0d0d0d] border border-slate-800 text-[10px] text-slate-300 font-mono pl-5 pr-2 py-1 outline-none focus:border-slate-600 placeholder:text-slate-700"
              />
              {logSearch && (
                <button onClick={() => setLogSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <X size={8} />
                </button>
              )}
            </div>

            {/* Status filter pills */}
            <div className="flex gap-1 flex-wrap">
              {(["all", "2xx", "3xx", "4xx", "5xx"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setLogStatusFilter(f)}
                  className={cn(
                    "text-[8px] px-1.5 py-0.5 border transition-colors",
                    logStatusFilter === f
                      ? f === "all" ? "border-slate-500 text-slate-300 bg-slate-800"
                        : f === "2xx" ? "border-emerald-700 text-emerald-400 bg-emerald-900/20"
                        : f === "3xx" ? "border-sky-700 text-sky-400 bg-sky-900/20"
                        : f === "4xx" ? "border-amber-700 text-amber-400 bg-amber-900/20"
                        : "border-red-700 text-red-400 bg-red-900/20"
                      : "border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700"
                  )}
                >{f.toUpperCase()}</button>
              ))}
              {canHideGkeHealthLogs && hiddenGkeHealthLogCount > 0 && (
                <button
                  onClick={() => setHideGkeHealthLogs(v => !v)}
                  className={cn(
                    "text-[8px] px-1.5 py-0.5 border transition-colors",
                    hideGkeHealthLogs
                      ? "border-slate-500 text-slate-300 bg-slate-800"
                      : "border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700"
                  )}
              >
                {hideGkeHealthLogs ? "HEALTH HIDDEN" : "HEALTH SHOWN"}
              </button>
              )}
              {(logSearch || logStatusFilter !== "all" || logMethodFilter !== "all" || (canHideGkeHealthLogs && hideGkeHealthLogs && hiddenGkeHealthLogCount > 0)) && (
                <span className="text-[8px] text-slate-600 self-center ml-1">{filteredLogs.length}/{logs.length}</span>
              )}
            </div>

            <div className="flex gap-1 flex-wrap">
              {(["all", ...LOG_METHODS] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setLogMethodFilter(m)}
                  className={cn(
                    "text-[8px] px-1.5 py-0.5 border transition-colors font-mono",
                    logMethodFilter === m
                      ? m === "all"
                        ? "border-slate-500 text-slate-300 bg-slate-800"
                        : `border-current bg-current/10 ${METHOD_COLOR[m]}`
                      : "border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {loadingLogs && (
              <div className="flex items-center gap-2 text-emerald-500 text-[10px]">
                <Loader2 size={10} className="animate-spin" /> Fetching logs…
              </div>
            )}
            {logsError && (
              <div className="border border-red-900/40 bg-red-900/10 p-2 text-red-400 text-[10px]">{logsError}</div>
            )}
            {!loadingLogs && !logsError && filteredLogs.length === 0 && (
              <p className="text-[10px] text-slate-600">{logs.length === 0 ? "No recent logs found." : "No logs match the current filter."}</p>
            )}
            {filteredLogs.map((l, i) => {
              const ts = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "";
              const severityColor =
                l.severity === "ERROR" ? "text-red-500" :
                l.severity === "WARNING" ? "text-amber-500" : "text-slate-600";

              // ── HTTP request log (Cloud Run / nginx structured logs) ──
              if (l.httpRequest) {
                const hr = l.httpRequest;
                const statusC =
                  !hr.status ? "text-slate-400" :
                  hr.status < 300 ? "text-emerald-400" :
                  hr.status < 400 ? "text-sky-400" :
                  hr.status < 500 ? "text-amber-400" : "text-red-400";
                const path = (() => { try { return new URL(hr.url).pathname; } catch { return hr.url; } })();
                const methodColor = METHOD_COLOR[hr.method] ?? "text-slate-400";
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedLogEntry(l)}
                    className="w-full border-b border-slate-800/30 pb-1.5 last:border-0 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={cn("text-[8px] font-bold w-10 shrink-0", methodColor)}>{hr.method}</span>
                      <span className={cn("text-[8px] font-bold shrink-0", statusC)}>{hr.status ?? "?"}</span>
                      <span className="text-[9px] text-white font-mono truncate">{path}</span>
                      <span className="text-[8px] text-slate-600 ml-auto shrink-0">{ts}</span>
                    </div>
                    <div className="flex gap-3 text-[8px] text-slate-600 font-mono">
                      {hr.remoteIp && <span title="Caller IP">{hr.remoteIp}</span>}
                      {hr.latency && <span>{hr.latency}</span>}
                      {hr.responseSize && <span>{hr.responseSize}B</span>}
                    </div>
                    {hr.userAgent && (
                      <p className="text-[8px] text-slate-700 truncate mt-0.5">{hr.userAgent}</p>
                    )}
                  </button>
                );
              }

              // ── Try to parse structured text log ([req], nginx JSON, Envoy) ──
              const parsed = parseReqLog(l.message) ?? parseStructuredRequestLog(l.message) ?? parseNginxLog(l.message) ?? parseEnvoyLog(l.message) ?? parseTraceAppLog(l.message);
              if (parsed) {
                const statusC =
                  parsed.status < 300 ? "text-emerald-400" :
                  parsed.status < 400 ? "text-sky-400" :
                  parsed.status < 500 ? "text-amber-400" : "text-red-400";
                const methodColor = METHOD_COLOR[parsed.method] ?? "text-slate-400";
                const source = l.container || l.pod || l.instanceId || "";
                const ip = (parsed as any).ip ?? (parsed as any).remoteIp ?? "";
                const body = (parsed as any).body ?? "";
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedLogEntry(l)}
                    className="w-full border-b border-slate-800/30 pb-1.5 last:border-0 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={cn("text-[8px] font-bold w-10 shrink-0", methodColor)}>{parsed.method}</span>
                      <span className={cn("text-[8px] font-bold shrink-0", statusC)}>{parsed.status}</span>
                      <span className="text-[9px] text-white font-mono truncate">{parsed.path}</span>
                      <span className="text-[8px] text-slate-600 ml-auto shrink-0">{ts}</span>
                    </div>
                    <div className="flex gap-3 text-[8px] text-slate-600 font-mono">
                      {ip && <span title="Caller IP">{ip}</span>}
                      <span>{parsed.latencyMs}ms</span>
                      {source && <span className="truncate text-slate-700">{source}</span>}
                    </div>
                    {body && (
                      <p className="text-[8px] text-slate-700 font-mono truncate mt-0.5" title={body}>{body}</p>
                    )}
                  </button>
                );
              }

              // ── Plain text / JSON log ──
              const source = l.revision || l.pod || l.instanceId || "";
              return (
                <button
                  key={i}
                  onClick={() => setSelectedLogEntry(l)}
                  className="w-full border-b border-slate-800/40 pb-1.5 last:border-0 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-[8px] font-bold shrink-0", severityColor)}>{l.severity}</span>
                    {source && <span className="text-[8px] text-slate-700 truncate">{source}</span>}
                    <span className="text-[8px] text-slate-700 ml-auto shrink-0">{ts}</span>
                  </div>
                  {l.message && (
                    <p className="text-[10px] text-slate-400 font-mono break-all leading-relaxed">{l.message}</p>
                  )}
                </button>
              );
            })}

            {filteredLogs.length > 0 && (
              <p className="text-[8px] text-slate-700 text-center">Press <kbd className="bg-slate-800 px-1 rounded text-slate-500">C</kbd> to copy · {filteredLogs.length} entries</p>
            )}

            {/* ── AI analysis panel ── */}
            {aiOpen && (
              <div className="border border-violet-900/40 bg-[#0a0010] flex flex-col">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-violet-900/30">
                  <Sparkles size={8} className="text-violet-400 shrink-0" />
                  <span className="text-[9px] uppercase tracking-widest text-violet-400 flex-1">AI Analysis</span>
                  <button onClick={() => setAiOpen(false)} className="text-violet-700 hover:text-violet-400 transition-colors"><X size={8} /></button>
                </div>

                {/* Question input */}
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-violet-900/20">
                  <input
                    value={aiQuestion}
                    onChange={e => setAiQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !aiState.loading) askAI(aiQuestion); }}
                    placeholder="Ask a question about these logs…"
                    className="flex-1 bg-transparent text-[10px] text-slate-300 placeholder-slate-700 outline-none font-mono"
                  />
                  <button
                    onClick={() => askAI(aiQuestion)}
                    disabled={aiState.loading}
                    className="text-violet-700 hover:text-violet-400 transition-colors disabled:opacity-40 shrink-0"
                    title="Ask (Enter)"
                  >
                    {aiState.loading ? <Loader2 size={8} className="animate-spin" /> : <Play size={8} />}
                  </button>
                </div>

                <div className="px-2 py-2 text-[10px] text-slate-400 leading-relaxed">
                  {aiState.loading && (
                    <div className="flex items-center gap-1.5 text-violet-400">
                      <Loader2 size={9} className="animate-spin" />
                      <span className="text-[9px]">Analyzing {filteredLogs.length} log entries…</span>
                    </div>
                  )}
                  {aiState.error && <p className="text-red-400 text-[9px]">{aiState.error}</p>}
                  {aiState.text && (
                    <div
                      className="text-[10px] leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderAiMd(aiState.text) }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ── Expanded overlay ── */}
            <AnimatePresence>
              {logsExpanded && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
                  onClick={() => setLogsExpanded(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="bg-[#0a0a0a] border border-slate-800 w-full max-w-4xl max-h-[85vh] flex flex-col"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Modal header */}
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 shrink-0">
                      <span className="text-[9px] uppercase tracking-widest text-slate-500 flex-1">{node.label} · Cloud Logging</span>
                      <span className="text-[8px] text-slate-600">{filteredLogs.length} entries</span>
                      <button onClick={handleCopyLogs} title="Copy (C)" className={cn("transition-colors", copyFlash ? "text-emerald-400" : "text-slate-600 hover:text-slate-300")}><Copy size={11} /></button>
                      <button onClick={() => setLogsExpanded(false)} className="text-slate-600 hover:text-slate-300 transition-colors"><X size={11} /></button>
                    </div>
                    {/* Modal filters */}
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 shrink-0">
                      <div className="relative flex-1">
                        <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                        <input
                          value={logSearch}
                          onChange={e => setLogSearch(e.target.value)}
                          placeholder="Search…"
                          className="w-full bg-[#0d0d0d] border border-slate-800 text-[10px] text-slate-300 font-mono pl-6 pr-2 py-1 outline-none focus:border-slate-600 placeholder:text-slate-700"
                        />
                        {logSearch && (
                          <button onClick={() => setLogSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"><X size={8} /></button>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {(["all", "2xx", "3xx", "4xx", "5xx"] as const).map(f => (
                          <button key={f} onClick={() => setLogStatusFilter(f)}
                            className={cn("text-[8px] px-1.5 py-0.5 border transition-colors",
                              logStatusFilter === f
                                ? f === "all" ? "border-slate-500 text-slate-300 bg-slate-800"
                                  : f === "2xx" ? "border-emerald-700 text-emerald-400 bg-emerald-900/20"
                                  : f === "3xx" ? "border-sky-700 text-sky-400 bg-sky-900/20"
                                  : f === "4xx" ? "border-amber-700 text-amber-400 bg-amber-900/20"
                                  : "border-red-700 text-red-400 bg-red-900/20"
                                : "border-slate-800 text-slate-600 hover:text-slate-400"
                            )}>{f.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 px-4 pb-2">
                      {(["all", ...LOG_METHODS] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setLogMethodFilter(m)}
                          className={cn(
                            "text-[8px] px-1.5 py-0.5 border transition-colors font-mono",
                            logMethodFilter === m
                              ? m === "all"
                                ? "border-slate-500 text-slate-300 bg-slate-800"
                                : `border-current bg-current/10 ${METHOD_COLOR[m]}`
                              : "border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700"
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    {/* Modal log list */}
                    <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1.5 font-mono text-[10px]">
                      {filteredLogs.map((l, i) => {
                        const ts = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "";
                        const parsed = !l.httpRequest ? (parseReqLog(l.message) ?? parseStructuredRequestLog(l.message) ?? parseTraceAppLog(l.message)) : null;
                        const status = l.httpRequest?.status ?? parsed?.status;
                        const method = l.httpRequest?.method ?? parsed?.method ?? "";
                        const path = l.httpRequest
                          ? (() => { try { return new URL(l.httpRequest!.url).pathname; } catch { return l.httpRequest!.url; } })()
                          : parsed?.path ?? "";
                        const ip = l.httpRequest?.remoteIp ?? (parsed as any)?.ip ?? (parsed as any)?.remoteIp ?? "";
                        const latency = l.httpRequest?.latency ?? (parsed ? `${parsed.latencyMs}ms` : "");
                        const body = parsed && "body" in parsed ? parsed.body ?? "" : "";
                        const pod = l.pod || l.instanceId || "";
                        const statusC = !status ? "text-slate-400"
                          : status < 300 ? "text-emerald-400"
                          : status < 400 ? "text-sky-400"
                          : status < 500 ? "text-amber-400" : "text-red-400";
                        const methodColor = METHOD_COLOR[method] ?? "text-slate-400";
                        if (method) return (
                          <button
                            key={i}
                            onClick={() => setSelectedLogEntry(l)}
                            className="flex w-full items-baseline gap-2 border-b border-slate-800/30 pb-1 last:border-0 text-left transition-colors hover:bg-white/[0.03]"
                          >
                            <span className="text-slate-700 shrink-0 w-16">{ts}</span>
                            <span className={cn("shrink-0 w-10 font-bold", methodColor)}>{method}</span>
                            <span className={cn("shrink-0 w-8 font-bold", statusC)}>{status ?? "?"}</span>
                            <span className="text-white flex-1 truncate">{path}</span>
                            <span className="text-slate-600 shrink-0">{ip}</span>
                            <span className="text-slate-700 shrink-0">{latency}</span>
                            {body && <span className="text-slate-700 truncate max-w-[200px]" title={body}>{body}</span>}
                          </button>
                        );
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedLogEntry(l)}
                            className="flex w-full items-baseline gap-2 border-b border-slate-800/30 pb-1 last:border-0 text-left transition-colors hover:bg-white/[0.03]"
                          >
                            <span className="text-slate-700 shrink-0 w-16">{ts}</span>
                            {pod && <span className="text-slate-700 shrink-0 truncate max-w-[120px]">{pod}</span>}
                            <span className="text-slate-400 flex-1 break-all">{l.message}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {selectedLogEntry && (
                <LogEntryModal
                  entry={selectedLogEntry}
                  onClose={() => setSelectedLogEntry(null)}
                />
              )}
            </AnimatePresence>
          </>
        )}

        {/* ── ROUTES tab ── */}
        {tab === "routes" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-slate-600">
                {routesSource ? `Discovered from ${routesSource}` : "Route Discovery"}
              </span>
              {node.matchUrl && (
                <span className="text-[8px] text-slate-700 font-mono truncate max-w-[120px]">{node.matchUrl}</span>
              )}
            </div>

            {loadingRoutes && (
              <div className="flex items-center gap-2 text-emerald-500 text-[10px]">
                <Loader2 size={10} className="animate-spin" /> Probing endpoints…
              </div>
            )}
            {!loadingRoutes && !node.matchUrl && (
              <p className="text-[10px] text-slate-600">No IP address known for this node — can't probe routes.</p>
            )}
            {!loadingRoutes && node.matchUrl && routes.length === 0 && (
              <p className="text-[10px] text-slate-600">No route introspection endpoint found.<br />Add <code className="text-slate-400">GET /routes</code> to your app.</p>
            )}
            {routes.map((r, i) => (
              <div key={i} className="border border-slate-800/60 bg-[#0a0a0a] p-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn("text-[9px] font-bold w-12 shrink-0", METHOD_COLOR[r.method] ?? "text-slate-400")}>{r.method}</span>
                  <span className="font-mono text-[10px] text-white">{r.path}</span>
                </div>
                {r.description && <p className="text-[9px] text-slate-500 pl-14">{r.description}</p>}
                {r.body && (
                  <pre className="text-[9px] text-slate-600 font-mono pl-14 mt-0.5">
                    {JSON.stringify(r.body, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2 px-2 py-1.5">
      <span className="text-[9px] text-slate-600 shrink-0">{label}</span>
      <span className={cn("text-[10px] text-slate-300 text-right break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export default function RequestTracer({ demoMode = false }: { demoMode?: boolean }) {
  // Snapshot + topology
  const [snapshot, setSnapshot] = useState<GcpSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [entryPoints, setEntryPoints] = useState<GkeEntryPoint[]>([]);
  const [loadingEntryPoints, setLoadingEntryPoints] = useState(true);
  const [traceSourceConfig, setTraceSourceConfig] = useState<GcpTraceSourceConfigSummary | null>(null);

  // Topology derived from snapshot + entry points — auto-updates when either changes
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => buildTopology(snapshot, entryPoints),
    [snapshot, entryPoints],
  );

  // Containers discovered per GKE node (used to build sidecar nodes)
  const [nodeContainers, setNodeContainers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (demoMode) return;
    fetch("/api/settings/trace-source/gcp")
      .then((r) => r.json())
      .then((d) => {
        if (d.config) {
          setTraceSourceConfig({
            mode: d.config.mode,
            computeSource: d.config.computeSource ?? "cloud_logging",
            gkeSource: d.config.gkeSource ?? "cloud_logging",
            setupState: d.config.setupState,
            lastCheckMessage: d.config.lastCheckMessage,
          });
        }
      })
      .catch(() => {});
  }, [demoMode]);

  // Eagerly fetch container lists for all GKE nodes so sidecar nodes appear
  useEffect(() => {
    const gkeNodes = baseNodes.filter(n => n.type === "gke" && n.projectId);
    for (const node of gkeNodes) {
      if (nodeContainers[node.id] !== undefined) continue; // already fetched/fetching
      setNodeContainers(prev => ({ ...prev, [node.id]: [] })); // mark as in-progress
      const params = new URLSearchParams({ projectId: node.projectId!, mode: "containers" });
      fetch(`/api/gcp/logs?${params}`)
        .then(r => r.json())
        .then(d => {
          const containers: string[] = d.containers ?? [];
          setNodeContainers(prev => ({ ...prev, [node.id]: containers }));
          if (containers.includes("istio-proxy")) handleIstioDetected(node.id);
        })
        .catch(() => {});
    }
  }, [baseNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build display topology: add sidecar nodes alongside existing col-3 nodes (SQL stays at col 3)
  const { nodes, edges } = useMemo(() => {
    const hasSidecars = baseNodes.some(
      n => n.type === "gke" && (nodeContainers[n.id] ?? []).length > 0
    );
    if (!hasSidecars) return { nodes: baseNodes, edges: baseEdges };

    // Keep existing nodes as-is — sidecars stack in col 3 next to SQL
    const newNodes: GraphNode[] = [...baseNodes];
    const newEdges: GraphEdge[] = [...baseEdges];

    baseNodes.filter(n => n.type === "gke").forEach(gkeNode => {
      // Sort containers by canonical request-processing order (istio-proxy, nginx, app...)
      const containers = [...(nodeContainers[gkeNode.id] ?? [])]
        .sort((a, b) => sidecarSortKey(a).localeCompare(sidecarSortKey(b)));

      containers.forEach((cname, idx) => {
        const sid = `sidecar-${gkeNode.id}-${cname}`;
        newNodes.push({
          id: sid, type: "sidecar", col: 3,
          label: cname.slice(0, 14).toUpperCase(),
          sublabel: gkeNode.label,
          projectId: gkeNode.projectId,
          container: cname,
          parentId: gkeNode.id,
        });
        // Chain: gke → first sidecar, then sidecar[i-1] → sidecar[i]
        const prevId = idx === 0 ? gkeNode.id : `sidecar-${gkeNode.id}-${containers[idx - 1]}`;
        newEdges.push({ from: prevId, to: sid });
      });
    });

    return { nodes: newNodes, edges: newEdges };
  }, [baseNodes, baseEdges, nodeContainers]);

  // Layout
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 360 });

  // Request form
  const [method, setMethod] = useState<typeof METHODS[number]>("POST");
  const [url, setUrl] = useState("");
  const [bodyText, setBodyText] = useState('{\n  "key": "value"\n}');
  const [methodOpen, setMethodOpen] = useState(false);
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>("all");
  const [selectedEndpointUrl, setSelectedEndpointUrl] = useState<string | null>(null);

  const usesPubSubSource = traceSourceConfig?.computeSource === "pubsub" || traceSourceConfig?.gkeSource === "pubsub";
  const usesAgentSource = traceSourceConfig?.gkeSource === "ebpf_agent";
  const traceSourceLabel = [
    usesPubSubSource ? "Pub/Sub" : null,
    usesAgentSource ? "eBPF" : null,
    (!usesPubSubSource || traceSourceConfig?.computeSource === "cloud_logging" || traceSourceConfig?.gkeSource === "cloud_logging") ? "Cloud Logging" : null,
  ].filter(Boolean).join(" + ") || "Cloud Logging";
  const showTraceSetupHint = usesPubSubSource && traceSourceConfig?.setupState !== "receiving_events";

  // Send state
  const [sending, setSending] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<Record<string, NodeStatus>>({});
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);

  // Node selection
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showResponse, setShowResponse] = useState(true);
  const [istioNodes, setIstioNodes] = useState<Set<string>>(new Set());
  const handleIstioDetected = useCallback((nodeId: string) => {
    setIstioNodes(prev => prev.has(nodeId) ? prev : new Set([...prev, nodeId]));
  }, []);

  // Request trace
  const [requestTime, setRequestTime] = useState<Date | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  // Live monitoring
  const [liveMode, setLiveMode] = useState(false);
  const [liveScope, setLiveScope] = useState<LiveScope>("active");
  const [liveAnimEnabled, setLiveAnimEnabled] = useState(true);
  const [liveIntensityEnabled, setLiveIntensityEnabled] = useState(false);
  const liveAnimEnabledRef = useRef(true);
  const liveIntensityEnabledRef = useRef(true);
  const liveModeRef = useRef(false);
  const liveLastTsByTarget = useRef<Record<string, string>>({});
  const liveLastAgentEventAtRef = useRef("");
  const livePollCursorRef = useRef(0);
  const liveCooldownUntilRef = useRef(0);
  const liveTimestamps = useRef<number[]>([]);   // sliding window of request timestamps
  const [liveRps, setLiveRps] = useState<number | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [livePulseBursts, setLivePulseBursts] = useState<LivePulseBurst[]>([]);
  const [selectedLiveEvent, setSelectedLiveEvent] = useState<LiveEvent | null>(null);
  const livePulseTimeoutsRef = useRef<Map<string, number>>(new Map());
  const liveStreamingLastEventAtRef = useRef(0);

  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  useEffect(() => {
    liveAnimEnabledRef.current = liveAnimEnabled;
  }, [liveAnimEnabled]);

  useEffect(() => {
    liveIntensityEnabledRef.current = liveIntensityEnabled;
  }, [liveIntensityEnabled]);

  // Demo simulation
  const [demoRps, setDemoRps] = useState<number | null>(null);
  const [demoRequestCount, setDemoRequestCount] = useState(0);
  const demoRunningRef = useRef(false);
  const demoReqCountRef = useRef(0);
  const requestActivityRate = liveMode ? liveRps : demoMode ? demoRps : null;
  const requestActivityTarget = useMemo(
    () => requestIntensityFromRate(requestActivityRate),
    [requestActivityRate]
  );
  const [requestActivityIntensity, setRequestActivityIntensity] = useState(0);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setRequestActivityIntensity(prev => {
        const next = prev + (requestActivityTarget - prev) * 0.16;
        if (Math.abs(next - requestActivityTarget) > 0.01) {
          frame = window.requestAnimationFrame(tick);
        }
        return next;
      });
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [requestActivityTarget]);

  // Fullscreen graph
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const liveSummaryRef = useRef<HTMLDivElement>(null);
  const liveConsoleRef = useRef<HTMLDivElement>(null);

  // Zoom / pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const hasDraggedRef = useRef(false);

  // Per-node dragging
  const [nodePositions, setNodePositions] = useState<Record<string, { cx: number; cy: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const nodeDragRef = useRef<{
    nodeId: string; startX: number; startY: number;
    startCx: number; startCy: number; moved: boolean;
  } | null>(null);

  // Hover state (used for fullscreen tooltips)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [cursorInContainer, setCursorInContainer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(z => Math.min(3, Math.max(0.3, z - event.deltaY * 0.001)));
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    hasDraggedRef.current = false;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDraggedRef.current = true;
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    }
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      setCursorInContainer({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
  }, []);

  const handlePointerUp = useCallback(() => { dragRef.current = null; }, []);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // ── Fetch snapshot ──────────────────────────────────────────────────────────
  const fetchSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    setLoadingEntryPoints(true);
    try {
      // Snapshot resolves quickly (DB read); entry points require GCP API calls — run in parallel
      const snapPromise = fetch("/api/gcp/snapshot").then(async r => {
        if (!r.ok) return;
        const data = await r.json();
        setSnapshot(data as GcpSnapshot);
      }).catch(() => {}).finally(() => setLoadingSnapshot(false));

      const epPromise = fetch("/api/gcp/cluster-entrypoints").then(async r => {
        if (!r.ok) return;
        const data = await r.json();
        setEntryPoints((data.entryPoints ?? []).filter((ep: GkeEntryPoint) => ep.ip));
      }).catch(() => {}).finally(() => setLoadingEntryPoints(false));

      await Promise.all([snapPromise, epPromise]);
    } catch { /* ignore */ }
    finally {
      setLoadingSnapshot(false);
      setLoadingEntryPoints(false);
    }
  }, []);

  useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);

  // Pre-fill URL in demo mode once snapshot is loaded
  useEffect(() => {
    if (!demoMode || !snapshot || url) return;
    const firstRun = (snapshot.cloudRunServices ?? []).find(s => s.url);
    if (firstRun) setUrl(firstRun.url!);
  }, [demoMode, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setGraphFullscreen(false); setSelectedNode(null); setShowResponse(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Clear hover when leaving fullscreen
  useEffect(() => { if (!graphFullscreen) setHoveredNode(null); }, [graphFullscreen]);

  // ── Container resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // ── Derived layout ──────────────────────────────────────────────────────────
  const maxCol = Math.max(...nodes.map(n => n.col), 0);
  const maxNodesInCol = Math.max(...Array.from({ length: maxCol + 1 }, (_, c) =>
    nodes.filter(n => n.col === c).length
  ), 1);
  const graphH = Math.max(
    maxNodesInCol * (NODE_H + NODE_GAP) - NODE_GAP + 2 * ROW_PADDING_Y,
    300
  );

  const basePos = useMemo(() => calcPositions(nodes, containerSize.w, graphH), [nodes, containerSize.w, graphH]);
  const activePath = useMemo(() => {
    const base = inferActivePath(url, nodes, edges);
    // Include sidecar nodes whose parent GKE is in path
    nodes.forEach(n => {
      if (n.type === "sidecar" && n.parentId && base.has(n.parentId)) base.add(n.id);
    });
    return base;
  }, [url, nodes, edges]);
  const focusedPos = useMemo(
    () => (url.trim() && activePath.size > 1
      ? calcFocusedPathPositions(nodes, activePath, containerSize.w, graphH)
      : {}),
    [activePath, containerSize.w, graphH, nodes, url]
  );
  const pos = useMemo(() => ({ ...basePos, ...focusedPos, ...nodePositions }), [basePos, focusedPos, nodePositions]);
  const lines = useMemo(() => buildSvgLines(edges, pos), [edges, pos]);

  const liveMonitorTarget = useMemo<LiveMonitorTarget | null>(() => {
    const buildGkeTarget = (pathNodeIds: Set<string>) => {
      const gkeNode = nodes.find(n => pathNodeIds.has(n.id) && n.type === "gke" && n.projectId);
      if (!gkeNode) return null;
      if (traceSourceConfig?.gkeSource === "ebpf_agent") {
        return {
          kind: "gke" as const,
          projectId: gkeNode.projectId!,
          container: "ebpf-agent",
          pathIds: pathNodeIds,
        };
      }
      const containers = nodeContainers[gkeNode.id] ?? [];
      const container = SIDECAR_ORDER.find(c => containers.includes(c)) ?? containers[0];
      if (!container) return null;
      return {
        kind: "gke" as const,
        projectId: gkeNode.projectId!,
        container,
        pathIds: pathNodeIds,
      };
    };

    const buildCloudRunTarget = (pathNodeIds: Set<string>) => {
      const runNode = nodes.find(
        n => pathNodeIds.has(n.id) && n.type === "cloudrun" && n.projectId && n.resourceName
      );
      if (!runNode) return null;
      return {
        kind: "cloudrun" as const,
        projectId: runNode.projectId!,
        service: runNode.resourceName!,
        region: runNode.region,
        pathIds: pathNodeIds,
      };
    };

    const buildVmTarget = (pathNodeIds: Set<string>) => {
      const vmNode = nodes.find(
        n => pathNodeIds.has(n.id) && n.type === "vm" && n.projectId && n.resourceName
      );
      if (!vmNode) return null;
      return {
        kind: "vm" as const,
        projectId: vmNode.projectId!,
        instance: vmNode.resourceName!,
        region: vmNode.region,
        pathIds: pathNodeIds,
      };
    };

    const pickTarget = (pathNodeIds: Set<string>) =>
      buildGkeTarget(pathNodeIds) ??
      buildCloudRunTarget(pathNodeIds) ??
      buildVmTarget(pathNodeIds);

    if (activePath.size > 1) {
      const matchedTarget = pickTarget(new Set(activePath));
      if (matchedTarget) return matchedTarget;
    }

    for (const node of nodes) {
      if (
        (node.type === "gke" && node.projectId) ||
        (node.type === "cloudrun" && node.projectId && node.resourceName) ||
        (node.type === "vm" && node.projectId && node.resourceName)
      ) {
        const fallbackTarget = pickTarget(buildPathForNode(node.id, edges));
        if (fallbackTarget) return fallbackTarget;
      }
    }

    return null;
  }, [activePath, edges, nodeContainers, nodes, traceSourceConfig?.gkeSource]);
  const hasFocusedLiveTarget = Boolean(url.trim() && activePath.size > 1 && liveMonitorTarget);

  const responseRouteNodes = useMemo(() => {
    const targetNode = activeTargetNodeFromPath(activePath, nodes);
    if (!targetNode) return [] as GraphNode[];
    return buildRouteToNode(targetNode.id, edges)
      .map(routeId => nodes.find(node => node.id === routeId) ?? null)
      .filter((node): node is GraphNode => !!node);
  }, [activePath, edges, nodes]);

  const openNodeDetail = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setShowResponse(false);
  }, []);

  const isEndpointSelected = useCallback((value: string) => {
    if (selectedEndpointUrl) return selectedEndpointUrl === value;
    if (!url.trim()) return false;
    if (url === value || url.startsWith(value)) return true;
    try {
      const current = new URL(url);
      const candidate = new URL(value);
      return current.host === candidate.host;
    } catch {
      return false;
    }
  }, [selectedEndpointUrl, url]);

  const toggleEndpointSelection = useCallback((value: string) => {
    setSelectedEndpointUrl(current => {
      const next = current === value ? null : value;
      setUrl(next ?? "");
      return next;
    });
  }, []);

  const clearEndpointSelection = useCallback(() => {
    setSelectedEndpointUrl(null);
    setUrl("");
  }, []);

  const filteredK8sEntryPoints = useMemo(
    () => entryPoints.filter(ep => ep.type !== "master-api" && ep.ip),
    [entryPoints]
  );
  const filteredLoadBalancers = useMemo(
    () => (snapshot?.loadBalancers ?? []).filter(lb => lb.ipAddress),
    [snapshot]
  );
  const filteredCloudRunServices = useMemo(
    () => (snapshot?.cloudRunServices ?? []).filter(service => service.url),
    [snapshot]
  );
  const filteredVmTargets = useMemo(
    () => (snapshot?.vms ?? []).filter(vm => !vm.name.startsWith("gke-") && vm.status === "RUNNING" && vm.externalIp),
    [snapshot]
  );

  const allLiveMonitorTargets = useMemo<LiveMonitorTarget[]>(() => {
    const targets: LiveMonitorTarget[] = [];
    const seen = new Set<string>();

    const addTarget = (target: LiveMonitorTarget | null) => {
      if (!target) return;
      const key = liveTargetKey(target);
      if (seen.has(key)) return;
      seen.add(key);
      targets.push(target);
    };

    nodes.forEach(node => {
      if (
        (node.type === "gke" && node.projectId) ||
        (node.type === "cloudrun" && node.projectId && node.resourceName) ||
        (node.type === "vm" && node.projectId && node.resourceName)
      ) {
        const pathNodeIds = buildPathForNode(node.id, edges);
        const target =
          node.type === "gke"
            ? (() => {
                if (traceSourceConfig?.gkeSource === "ebpf_agent") {
                  return {
                    kind: "gke" as const,
                    projectId: node.projectId!,
                    container: "ebpf-agent",
                    pathIds: pathNodeIds,
                  };
                }
                const containers = nodeContainers[node.id] ?? [];
                const container = SIDECAR_ORDER.find(c => containers.includes(c)) ?? containers[0];
                if (!container) return null;
                return {
                  kind: "gke" as const,
                  projectId: node.projectId!,
                  container,
                  pathIds: pathNodeIds,
                };
              })()
            : node.type === "cloudrun"
              ? {
                  kind: "cloudrun" as const,
                  projectId: node.projectId!,
                  service: node.resourceName!,
                  region: node.region,
                  pathIds: pathNodeIds,
                }
              : {
                  kind: "vm" as const,
                  projectId: node.projectId!,
                  instance: node.resourceName!,
                  region: node.region,
                  pathIds: pathNodeIds,
                };
        addTarget(target);
      }
    });

    return targets;
  }, [edges, nodeContainers, nodes, traceSourceConfig?.gkeSource]);

  const demoLiveTargets = useMemo<LiveMonitorTarget[]>(() => {
    if (!demoMode) return [];
    const targets: LiveMonitorTarget[] = [];
    const seen = new Set<string>();
    nodes.forEach(node => {
      if (
        (node.type === "cloudrun" && node.projectId && node.resourceName) ||
        (node.type === "vm" && node.projectId && node.resourceName) ||
        (node.type === "gke" && node.projectId)
      ) {
        const pathIds = buildPathForNode(node.id, edges);
        const target =
          node.type === "cloudrun"
            ? {
                kind: "cloudrun" as const,
                projectId: node.projectId!,
                service: node.resourceName!,
                region: node.region,
                pathIds,
              }
            : node.type === "vm"
              ? {
                  kind: "vm" as const,
                  projectId: node.projectId!,
                  instance: node.resourceName!,
                  region: node.region,
                  pathIds,
                }
              : {
                  kind: "gke" as const,
                  projectId: node.projectId!,
                  container: "demo-app",
                  pathIds,
                };
        const key = liveTargetKey(target);
        if (!seen.has(key)) {
          seen.add(key);
          targets.push(target);
        }
      }
    });
    return targets;
  }, [demoMode, edges, nodes]);

  const liveEventsOrdered = useMemo(
    () => [...liveEvents].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [liveEvents]
  );
  const liveEventsFeatured = useMemo(
    () => [...liveEvents]
      .sort((a, b) => {
        const prio = requestPriority(a.method, a.path) - requestPriority(b.method, b.path);
        if (prio !== 0) return prio;
        return new Date(b.ts).getTime() - new Date(a.ts).getTime();
      })
      .slice(0, 6),
    [liveEvents]
  );

  useEffect(() => {
    if (!liveMode || liveEventsOrdered.length === 0) return;
    if (liveSummaryRef.current) {
      liveSummaryRef.current.scrollTop = liveSummaryRef.current.scrollHeight;
    }
    if (liveConsoleRef.current) {
      liveConsoleRef.current.scrollTop = liveConsoleRef.current.scrollHeight;
    }
  }, [liveEventsOrdered, liveMode]);

  // ── BFS pulse animation (shared by handleSend and live mode) ────────────────
  // colDelay: ms between waves (default = ANIM_COL_DELAY); resetAfterMs: if >0 fade to idle
  const runBfsAnimation = useCallback(async (
    pathIds: Set<string>,
    { colDelay = ANIM_COL_DELAY, resetAfterMs = 0 } = {},
  ) => {
    const visited = new Set<string>(["internet"]);
    const waves: string[][] = [["internet"].filter(id => pathIds.has(id))];
    if (waves[0].length === 0) return;
    let wi = 0;
    while (wi < waves.length) {
      const next: string[] = [];
      for (const id of waves[wi]) {
        edges
          .filter(e => e.from === id && pathIds.has(e.to) && !visited.has(e.to))
          .forEach(e => { visited.add(e.to); next.push(e.to); });
      }
      if (next.length > 0) waves.push(next);
      wi++;
    }
    for (let i = 0; i < waves.length; i++) {
      if (i > 0) await sleep(colDelay);
      setNodeStatus(prev => {
        const s = { ...prev };
        waves[i].forEach(id => { s[id] = "active"; });
        return s;
      });
    }
    await sleep(ANIM_PULSE_MS);
    const allIds = new Set(waves.flat());
    setNodeStatus(prev => {
      const s = { ...prev };
      allIds.forEach(id => { s[id] = "done"; });
      return s;
    });
    if (resetAfterMs > 0) {
      await sleep(resetAfterMs);
      setNodeStatus(prev => {
        const s = { ...prev };
        allIds.forEach(id => { if (s[id] === "done") delete s[id]; });
        return s;
      });
    }
  }, [edges]);

  const emitLivePulseBurst = useCallback((pathIds: Set<string>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLivePulseBursts(prev => [...prev, { id, pathIds: new Set(pathIds) }].slice(-24));
    const timeoutId = window.setTimeout(() => {
      livePulseTimeoutsRef.current.delete(id);
      setLivePulseBursts(prev => prev.filter(burst => burst.id !== id));
    }, LIVE_STREAM_PULSE_MS);
    livePulseTimeoutsRef.current.set(id, timeoutId);
  }, []);

  useEffect(() => {
    if (liveMode) return;
    livePulseTimeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
    livePulseTimeoutsRef.current.clear();
    setLivePulseBursts([]);
  }, [liveMode]);

  useEffect(() => {
    return () => {
      livePulseTimeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
      livePulseTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const useStreamingLive = shouldUseStreamingLive(demoMode, traceSourceConfig);
    if (!useStreamingLive || !liveMode) return;

    const eventSource = new EventSource("/api/trace/live");
    eventSource.addEventListener("trace", (rawEvent) => {
      const parsed = JSON.parse((rawEvent as MessageEvent).data) as LiveTraceIngressEvent;
      liveStreamingLastEventAtRef.current = Date.now();
      if (sourceForKind(parsed.kind, traceSourceConfig) !== "pubsub") {
        return;
      }

      const uiEvent = toLiveEventFromIngress(parsed, nodes);
      const nowMs = eventTimestampMs(uiEvent.ts) || Date.now();
      liveTimestamps.current.push(nowMs);
      liveTimestamps.current = liveTimestamps.current.filter(t => nowMs - t < 60_000);
      setLiveRps(estimateRateFromTimestamps(liveTimestamps.current, nowMs, LIVE_RPS_WINDOW_MS));

      if (liveScope !== "all" && isExpectedLiveRequest({ path: parsed.path, userAgent: parsed.userAgent })) {
        return;
      }

      if (liveScope === "active" && hasFocusedLiveTarget && liveMonitorTarget) {
        if (!ingressEventMatchesLiveTarget(parsed, liveMonitorTarget)) {
          return;
        }
      }

      setLiveEvents(prev => {
        const retainedPrev = prev.filter(event => nowMs - eventTimestampMs(event.ts) < LIVE_EVENT_RETENTION_MS);
        const merged = [...retainedPrev, uiEvent];
        return merged.slice(-24);
      });

      if (liveAnimEnabledRef.current) {
        const pathIds = buildPathForIngressEvent(parsed, nodes, edges, liveMonitorTarget);
        if (!pathIds) return;
        emitLivePulseBurst(pathIds);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [demoMode, edges, emitLivePulseBurst, hasFocusedLiveTarget, liveMode, liveMonitorTarget, liveScope, nodes, traceSourceConfig]);

  // ── Demo simulation: auto-animate traffic through topology ──────────────────
  useEffect(() => {
    if (!demoMode || nodes.length < 2 || loadingSnapshot) return;
    if (demoRunningRef.current) return;
    demoRunningRef.current = true;

    // Build candidate paths through the topology using BFS from internet
    const buildPath = (targetTypes: NodeType[]): Set<string> => {
      const path = new Set<string>(["internet"]);
      for (const type of targetTypes) {
        const candidate = nodes.find(n => n.type === type && !path.has(n.id));
        if (!candidate) continue;
        // Include edge intermediaries: find LB nodes between internet and compute
        if (type !== "lb") {
          const lbNode = nodes.find(n => n.type === "lb" &&
            edges.some(e => e.from === "internet" && e.to === n.id) &&
            edges.some(e => e.from === n.id && e.to === candidate.id)
          );
          if (lbNode) path.add(lbNode.id);
        }
        path.add(candidate.id);
        // Pull in downstream data nodes connected to this compute node
        const downstream = edges
          .filter(e => e.from === candidate.id)
          .map(e => nodes.find(n => n.id === e.to))
          .filter((n): n is GraphNode => !!n && (n.type === "cloudsql"));
        downstream.forEach(n => path.add(n.id));
      }
      return path;
    };

    // Weighted scenario pool — mix of Cloud Run hits, GKE+SQL queries, errors
    const scenarios: Array<{ path: () => Set<string>; colDelay: number; error?: boolean; weight: number }> = [
      { path: () => buildPath(["cloudrun"]), colDelay: 140, weight: 35 },
      { path: () => buildPath(["gke", "cloudsql"]), colDelay: 200, weight: 25 },
      { path: () => buildPath(["gke"]), colDelay: 160, weight: 20 },
      { path: () => {
          // Pick ALL cloudrun nodes for a broadcast-style scan hit
          const all = new Set<string>(["internet"]);
          nodes.filter(n => n.type === "cloudrun").forEach(n => all.add(n.id));
          return all;
        }, colDelay: 110, weight: 10 },
      { path: () => buildPath(["cloudrun"]), colDelay: 120, error: true, weight: 10 },
    ];

    // Weighted random pick
    const pickScenario = () => {
      const total = scenarios.reduce((s, sc) => s + sc.weight, 0);
      let r = Math.random() * total;
      for (const sc of scenarios) { r -= sc.weight; if (r <= 0) return sc; }
      return scenarios[0];
    };

    // RPS tracking
    const rpsWindow: number[] = [];
    const updateRps = () => {
      const now = Date.now();
      rpsWindow.push(now);
      const cutoff = now - 10_000;
      while (rpsWindow.length && rpsWindow[0] < cutoff) rpsWindow.shift();
      setDemoRps(rpsWindow.length / 10);
    };

    let running = true;
    const run = async () => {
      // Small staggered start so the graph doesn't animate on first render
      await sleep(1200);
      while (running) {
        const sc = pickScenario();
        const path = sc.path();
        if (path.size < 2) { await sleep(800); continue; }

        updateRps();
        demoReqCountRef.current += 1;
        setDemoRequestCount(demoReqCountRef.current);

        if (sc.error) {
          // Animate up to last compute node, then mark it error
          await runBfsAnimation(path, { colDelay: sc.colDelay });
          const errNode = [...path]
            .map(id => nodes.find(n => n.id === id))
            .filter((n): n is GraphNode => !!n && n.col >= 2)
            .sort((a, b) => b.col - a.col)[0];
          if (errNode) setNodeStatus(prev => ({ ...prev, [errNode.id]: "error" }));
          await sleep(600);
          setNodeStatus(prev => {
            const s = { ...prev };
            path.forEach(id => { if (s[id] === "error" || s[id] === "done") delete s[id]; });
            return s;
          });
        } else {
          await runBfsAnimation(path, { colDelay: sc.colDelay, resetAfterMs: 900 });
        }

        // Variable inter-request gap: 0.4–1.8s
        const gap = 400 + Math.random() * 1400;
        await sleep(gap);
      }
    };

    run();
    return () => { running = false; demoRunningRef.current = false; };
  }, [demoMode, nodes, edges, loadingSnapshot, runBfsAnimation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live monitoring: poll Cloud Logging, fire pulse on new traffic ───────────
  useEffect(() => {
    liveModeRef.current = liveMode;
    if (!liveMode) {
      liveLastTsByTarget.current = {};
      liveLastAgentEventAtRef.current = "";
      livePollCursorRef.current = 0;
      liveCooldownUntilRef.current = 0;
      liveTimestamps.current = [];
      setLiveRps(null);
      setLiveEvents([]);
      return;
    }

    const allTargets = liveScope === "all"
      ? allLiveMonitorTargets
      : (liveMonitorTarget ? [liveMonitorTarget] : []);
    const hasGkeNodes = nodes.some(node => node.type === "gke");
    if (allTargets.length === 0 && !hasGkeNodes) return;

    const startTs = new Date().toISOString();
    allTargets.forEach(target => {
      const key = liveTargetKey(target);
      if (!liveLastTsByTarget.current[key]) {
        liveLastTsByTarget.current[key] = startTs;
      }
    });
    if (!liveLastAgentEventAtRef.current) {
      liveLastAgentEventAtRef.current = startTs;
    }
    let busy = false;

    const poll = async () => {
      if (!liveModeRef.current || busy) return;
      if (Date.now() < liveCooldownUntilRef.current) return;
      const pollNowMs = Date.now();
      setLiveEvents(prev => prev.filter(event => pollNowMs - eventTimestampMs(event.ts) < LIVE_EVENT_RETENTION_MS));
      liveTimestamps.current = liveTimestamps.current.filter(t => pollNowMs - t < 60_000);
      setLiveRps(estimateRateFromTimestamps(liveTimestamps.current, pollNowMs, LIVE_RPS_WINDOW_MS));
      const includeExpectedRequests = liveScope === "all";
      const agentEventsPromise = shouldUseAgentEvents(traceSourceConfig)
        ? fetch(
            `/api/agents/events/query?${new URLSearchParams({
              after: liveLastAgentEventAtRef.current,
              limit: "20",
            })}`
          )
            .then(async (res) => {
              if (!res.ok) return [] as AgentEventRow[];
              const data = await res.json().catch(() => ({}));
              return (data.events ?? []) as AgentEventRow[];
            })
            .catch(() => [] as AgentEventRow[])
        : Promise.resolve([] as AgentEventRow[]);
      const cloudLoggingTargets = allTargets.filter(target => shouldPollLiveTarget(target, traceSourceConfig));
      const targets = liveScope === "all" && cloudLoggingTargets.length > LIVE_ALL_CLOUD_LOGGING_BATCH_SIZE
        ? (() => {
            const start = livePollCursorRef.current % cloudLoggingTargets.length;
            const batch = Array.from(
              { length: LIVE_ALL_CLOUD_LOGGING_BATCH_SIZE },
              (_, i) => cloudLoggingTargets[(start + i) % cloudLoggingTargets.length],
            );
            livePollCursorRef.current = (start + batch.length) % cloudLoggingTargets.length;
            return batch;
          })()
        : cloudLoggingTargets;
      try {
        const [agentEvents, results] = await Promise.all([
          agentEventsPromise,
          Promise.all(
            targets.map(async (target) => {
              const key = liveTargetKey(target);
              const after = liveLastTsByTarget.current[key] ?? startTs;
              const params = buildLiveLogParams(target, after);
              const res = await fetch(`/api/gcp/logs?${params}`);
              const data = await res.json().catch(() => ({}));
              if (res.status === 429 || data?.code === "rate_limited") {
                const retryAfterSec = Number(data?.retryAfterSec ?? 30);
                liveCooldownUntilRef.current = Date.now() + retryAfterSec * 1000;
                return { target, entries: [] as LogEntry[], rateLimited: true };
              }
              if (!res.ok) {
                return { target, entries: [] as LogEntry[], rateLimited: false };
              }
              const entries: LogEntry[] = data.entries ?? [];
              if (entries.length > 0) {
                const latest = entries.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
                liveLastTsByTarget.current[key] = latest.timestamp;
              }
              const freshEntries = entries.filter(entry => {
                const tsMs = eventTimestampMs(entry.timestamp);
                return tsMs > 0 && pollNowMs - tsMs <= LIVE_EVENT_FRESHNESS_MS;
              });
              return { target, entries: freshEntries, rateLimited: false };
            })
          ),
        ]);

        if (results.some(result => result.rateLimited)) {
          return;
        }

        const rawEntries = results.flatMap(result => result.entries);
        const rawAgentEvents = agentEvents.filter(event => {
          const tsMs = eventTimestampMs(event.received_at);
          return tsMs > 0 && pollNowMs - tsMs <= LIVE_EVENT_FRESHNESS_MS;
        });

        const filteredResults = results.map(result => ({
          ...result,
          entries: result.entries.filter(entry => {
            const parsed = parseLiveRequestLog(entry);
            return parsed && (includeExpectedRequests || !isExpectedLiveRequest(parsed));
          }),
        }));
        const allEntries = filteredResults.flatMap(result => result.entries);
        const freshAgentEvents = agentEvents.filter(event => {
          const tsMs = eventTimestampMs(event.received_at);
          return tsMs > 0
            && pollNowMs - tsMs <= LIVE_EVENT_FRESHNESS_MS
            && (includeExpectedRequests || !isExpectedAgentLiveEvent(event));
        });
        if (agentEvents.length > 0) {
          const latestAgentEvent = agentEvents.reduce((a, b) =>
            eventTimestampMs(a.received_at) > eventTimestampMs(b.received_at) ? a : b
          );
          liveLastAgentEventAtRef.current = latestAgentEvent.received_at;
        }

        const rawTrafficTimestamps = [
          ...rawEntries
            .map(entry => eventTimestampMs(entry.timestamp))
            .filter(ts => ts > 0),
          ...rawAgentEvents
            .map(event => eventTimestampMs(event.received_at))
            .filter(ts => ts > 0),
        ];
        if (rawTrafficTimestamps.length > 0) {
          liveTimestamps.current.push(...rawTrafficTimestamps);
          liveTimestamps.current = liveTimestamps.current.filter(t => pollNowMs - t < 60_000);
          setLiveRps(estimateRateFromTimestamps(liveTimestamps.current, pollNowMs, LIVE_RPS_WINDOW_MS));
        }

        if (allEntries.length > 0 || freshAgentEvents.length > 0) {
          const newEvents = filteredResults
            .flatMap(result => toLiveEvents(result.target, result.entries, nodes, includeExpectedRequests));
          const agentLiveEvents = freshAgentEvents
            .map(event => toLiveEventFromAgentEvent(event, nodes))
            .filter(event => event.focusNodeId);
          const mergedNewEvents = [...newEvents, ...agentLiveEvents]
            .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
          if (mergedNewEvents.length > 0) {
            setLiveEvents(prev => {
              const retainedPrev = prev.filter(event => pollNowMs - eventTimestampMs(event.ts) < LIVE_EVENT_RETENTION_MS);
              const merged = [...mergedNewEvents, ...retainedPrev];
              const deduped: LiveEvent[] = [];
              const seen = new Set<string>();
              for (const event of merged) {
                if (seen.has(event.id)) continue;
                seen.add(event.id);
                deduped.push(event);
                if (deduped.length >= LIVE_EVENT_LIMIT) break;
              }
              return deduped;
            });
          }
          if (liveAnimEnabledRef.current) {
            busy = true;
            const targetsWithHits = filteredResults.filter(result => result.entries.length > 0);
            if (targets.length === 1) {
              const [{ target, entries }] = targetsWithHits;
              if (target) {
                const pulses = Math.min(Math.max(1, Math.ceil(entries.length / 2)), 8);
                for (let p = 0; p < pulses; p++) {
                  if (!liveModeRef.current) break;
                  if (p > 0) await sleep(180);
                  await runBfsAnimation(target.pathIds, { colDelay: 110, resetAfterMs: 450 });
                }
              }
            } else {
              const animatedTargets = targetsWithHits
                .sort((a, b) => b.entries.length - a.entries.length)
                .slice(0, 8);
              for (let i = 0; i < animatedTargets.length; i++) {
                if (!liveModeRef.current) break;
                if (i > 0) await sleep(140);
                await runBfsAnimation(animatedTargets[i].target.pathIds, { colDelay: 110, resetAfterMs: 420 });
              }
            }
            const animatedAgentEvents = freshAgentEvents.slice(0, 8);
            for (let i = 0; i < animatedAgentEvents.length; i++) {
              if (!liveModeRef.current) break;
              const pathIds = buildPathForAgentEvent(animatedAgentEvents[i], nodes, edges, liveMonitorTarget);
              if (!pathIds) continue;
              if (i > 0) await sleep(140);
              await runBfsAnimation(pathIds, { colDelay: 110, resetAfterMs: 420 });
            }
            busy = false;
          }
        }
      } catch { /* ignore polling errors */ }
    };

    const pollIntervalMs = liveScope === "all" ? LIVE_POLL_ALL_MS : LIVE_POLL_ACTIVE_MS;
    const id = setInterval(poll, pollIntervalMs);
    poll(); // immediate first check
    return () => { clearInterval(id); };
  }, [allLiveMonitorTargets, demoMode, liveMode, liveMonitorTarget, liveScope, nodes, runBfsAnimation, traceSourceConfig]);

  useEffect(() => {
    if (!demoMode || !liveMode || demoLiveTargets.length === 0) return;

    let running = true;
    const run = async () => {
      await sleep(600);
      while (running) {
        const targetCount = liveScope === "all"
          ? Math.min(demoLiveTargets.length, 1 + Math.floor(Math.random() * Math.min(3, demoLiveTargets.length)))
          : 1;
        const shuffled = [...demoLiveTargets].sort(() => Math.random() - 0.5);
        const targets = liveScope === "all"
          ? shuffled.slice(0, targetCount)
          : [shuffled[0]];
        const ts = new Date().toISOString();
        const events = targets.map(target => toDemoLiveEvent(target, ts, 1 + Math.floor(Math.random() * 6), nodes));

        setLiveEvents(prev => {
          const merged = [...prev, ...events];
          return merged.slice(-24);
        });

        const nowMs = Date.now();
        events.forEach(() => liveTimestamps.current.push(nowMs));
        liveTimestamps.current = liveTimestamps.current.filter(t => nowMs - t < 60_000);
        setLiveRps(estimateRateFromTimestamps(liveTimestamps.current, nowMs, LIVE_RPS_WINDOW_MS));

        if (liveAnimEnabledRef.current) {
          for (let i = 0; i < targets.length; i++) {
            if (!running) break;
            if (i > 0) await sleep(180);
            await runBfsAnimation(targets[i].pathIds, { colDelay: 140, resetAfterMs: 700 });
          }
        }

        await sleep(1200 + Math.random() * 2200);
      }
    };

    run();
    return () => { running = false; };
  }, [demoLiveTargets, demoMode, liveMode, liveScope, nodes, runBfsAnimation]);

  useEffect(() => {
    if (!selectedLiveEvent) return;
    const updated = liveEvents.find(event => event.id === selectedLiveEvent.id);
    if (updated) {
      setSelectedLiveEvent(updated);
      return;
    }
    if (!liveEvents.some(event => event.id === selectedLiveEvent.id)) {
      setSelectedLiveEvent(null);
    }
  }, [liveEvents, selectedLiveEvent]);

  // ── Send request ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const targetUrls = [selectedEndpointUrl ?? url.trim()].filter(Boolean);
    if (sending || targetUrls.length === 0) return;

    const invalidUrl = targetUrls.find(targetUrl => getProxyUrlValidationError(targetUrl));
    const validationError = invalidUrl ? getProxyUrlValidationError(invalidUrl) : null;
    if (validationError) {
      setResponse({ ok: false, error: validationError, timing: 0 });
      setRequestTime(new Date());
      setShowTrace(false);
      setNodeStatus({});
      return;
    }

    setSending(true);
    setResponse(null);
    setRequestTime(new Date());
    setShowTrace(false);

    // Reset status
    setNodeStatus({});

    // Start HTTP request immediately (parallel with animation)
    let parsedBody: any = undefined;
    if (method !== "GET" && method !== ("HEAD" as string) && bodyText.trim()) {
      const p = tryParseJson(bodyText);
      parsedBody = p.ok ? p.val : bodyText;
    }

    const httpPromise = targetUrls.length === 1
      ? fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrls[0], method, body: parsedBody }),
        }).then(r => r.json() as Promise<ProxyResponse>)
      : Promise.all(
          targetUrls.map(async targetUrl => {
            const res = await fetch("/api/proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: targetUrl, method, body: parsedBody }),
            });
            return res.json() as Promise<ProxyResponse>;
          })
        ).then(results => {
          const failed = results.find(result => !result.ok);
          if (failed) return failed;
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            timing: Math.max(...results.map(result => result.timing)),
            body: JSON.stringify({ broadcast: results.length, results }, null, 2),
            headers: {},
          } as ProxyResponse;
        });

    // BFS pulse through the active path (handles sidecar chains in correct order)
    await runBfsAnimation(activePath);

    // Wait for HTTP response
    try {
      const result = await httpPromise;
      setResponse(result);
      if (!result.ok && result.error) {
        // Mark the last compute/sidecar node in the active path as error
        const lastNode = [...activePath]
          .map(id => nodes.find(n => n.id === id))
          .filter((n): n is GraphNode => !!n && n.col >= 2)
          .sort((a, b) => b.col - a.col || b.id.localeCompare(a.id))[0];
        if (lastNode) {
          setNodeStatus(prev => ({ ...prev, [lastNode.id]: "error" }));
        }
      }
    } catch (err: any) {
      setResponse({ ok: false, error: err.message, timing: 0 });
    }

    setSending(false);
  }, [sending, url, method, bodyText, nodes, activePath, runBfsAnimation, selectedEndpointUrl]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex gap-4 min-h-0",
        graphFullscreen
          ? "fixed inset-0 z-50 bg-[#02040a] p-4"
          : ""
      )}
      style={{
        fontFamily: "var(--font-mono, monospace)",
        ...(graphFullscreen ? {} : { height: "calc(100vh - 260px)" }),
      }}
    >

      {/* ── Left: Request builder ─────────────────────────────────────── */}
      {!graphFullscreen && <div className="w-[260px] shrink-0 flex flex-col min-h-0 gap-2">

        {/* Fixed top: label + method/url */}
        <div className="shrink-0 flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Request</div>

          {/* Method + URL */}
          <div className="flex gap-2">
            <div className="relative shrink-0">
              <button
                onClick={() => setMethodOpen(o => !o)}
                className="flex items-center gap-1 px-2 py-2 border border-slate-800 bg-[#0d0d0d] text-xs hover:border-slate-600 transition-colors"
              >
                <span className={cn("font-bold", METHOD_COLOR[method])}>{method}</span>
                <ChevronDown size={10} className="text-slate-500" />
              </button>
              <AnimatePresence>
                {methodOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 mt-1 z-20 border border-slate-700 bg-[#0d0d0d] min-w-[90px]"
                  >
                    {METHODS.map(m => (
                      <button key={m} onClick={() => { setMethod(m); setMethodOpen(false); }}
                        className={cn("block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5", METHOD_COLOR[m])}
                      >{m}</button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <input
              type="text"
              value={url}
              onChange={e => {
                clearEndpointSelection();
                setUrl(e.target.value);
              }}
              placeholder="https://..."
              className="flex-1 min-w-0 px-2 py-2 bg-[#0d0d0d] border border-slate-800 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-800"
            />
          </div>

        </div>

        {/* Scrollable middle: targets + body */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-2">

          {/* URL suggestions */}
          {(loadingEntryPoints || snapshot || entryPoints.length > 0) && (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap gap-1 px-1 pb-1">
                {ENDPOINT_FILTERS.map(filter => (
                  <button
                    key={filter.id}
                    onClick={() => {
                      setEndpointFilter(filter.id);
                    }}
                    className={cn(
                      "px-2 py-1 text-[9px] uppercase tracking-widest border transition-colors",
                      endpointFilter === filter.id
                        ? "border-emerald-800/80 bg-emerald-950/30 text-emerald-300"
                        : "border-slate-800/70 bg-[#090909] text-slate-500 hover:text-slate-300 hover:border-slate-700"
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {loadingEntryPoints ? (
                <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-slate-600">
                  <Loader2 size={9} className="animate-spin shrink-0" />
                  <span>Scanning GKE entry points…</span>
                </div>
              ) : (endpointFilter === "all" || endpointFilter === "k8s") && filteredK8sEntryPoints.length > 0 && (
                <div className="text-[9px] uppercase tracking-widest text-slate-600 px-1">GKE Entry Points</div>
              )}
              {!loadingEntryPoints && (endpointFilter === "all" || endpointFilter === "k8s") && filteredK8sEntryPoints.map(ep => {
                const proto = "http";
                const value = `${proto}://${ep.ip}`;
                const svcLabel = ep.k8sService ? ` · ${ep.k8sService}` : "";
                const label = `${ep.clusterName}${svcLabel}`;
                const typeTag = ep.type === "master-api" ? "API" : ep.type === "ingress" ? "ING" : "LB";
                const isSelected = isEndpointSelected(value);
                return (
                  <HoverTooltip
                    key={`ep-${ep.clusterName}-${ep.ip}-${ep.type}`}
                    content={
                      <>
                        <div className="text-emerald-400 font-bold uppercase tracking-widest text-[8px] mb-1">{label}</div>
                        <div className="text-sky-300 font-mono">{value}</div>
                        {ep.isPublic && <div className="text-amber-400 mt-1">Public endpoint</div>}
                      </>
                    }
                  >
                    <button onClick={() => toggleEndpointSelection(value)}
                      className={cn(
                        "w-full text-left text-[10px] px-2 py-1.5 transition-colors rounded-sm relative overflow-hidden",
                        isSelected
                          ? "bg-emerald-950/60 ring-2 ring-emerald-500/80 border border-emerald-500/35 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.22)]"
                          : "bg-[#0a0a0a]/60 hover:bg-[#0d120e]"
                      )}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn(
                          "text-[8px] font-bold px-1 py-px rounded-sm",
                          isSelected ? "text-emerald-300 bg-emerald-900/40" : "text-emerald-700 bg-emerald-950/30"
                        )}>{typeTag}</span>
                        <span className={cn("break-words", isSelected ? "text-slate-200" : "text-slate-400")}>{label}</span>
                        {isSelected && <span className="text-[8px] text-emerald-300 uppercase tracking-widest">Selected</span>}
                        {ep.isPublic && <span className="text-[8px] text-amber-500 uppercase tracking-widest">Public</span>}
                      </div>
                      <div className={cn("mt-0.5 font-mono whitespace-pre-wrap break-all", isSelected ? "text-emerald-300" : "text-sky-400")}>{value}</div>
                    </button>
                  </HoverTooltip>
                );
              })}
              {snapshot && (
                <>
                  {(endpointFilter === "all" || endpointFilter === "compute") &&
                    (filteredLoadBalancers.length > 0 || filteredVmTargets.length > 0) && (
                      <div className="text-[9px] uppercase tracking-widest text-slate-600 px-1 pt-1">Compute Endpoints</div>
                  )}
                  {(endpointFilter === "all" || endpointFilter === "compute") && filteredLoadBalancers.map(lb => {
                    const value = `http://${lb.ipAddress}`;
                    const isSelected = isEndpointSelected(value);
                    return (
                      <HoverTooltip
                        key={`lb-${lb.ipAddress}`}
                        content={
                          <>
                            <div className="text-violet-300 font-bold uppercase tracking-widest text-[8px] mb-1">{lb.name}</div>
                            <div className="text-sky-300 font-mono">{value}</div>
                          </>
                        }
                      >
                        <button onClick={() => toggleEndpointSelection(value)}
                          className={cn(
                            "w-full text-left text-[10px] px-2 py-1.5 transition-colors rounded-sm relative overflow-hidden",
                            isSelected
                              ? "bg-violet-950/55 ring-2 ring-violet-500/80 border border-violet-500/35 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.22)]"
                              : "bg-[#0a0a0a]/60 hover:bg-[#0d1013]"
                          )}
                        >
                          <div className={cn("break-words", isSelected ? "text-slate-200" : "text-slate-400")}>
                            {lb.name}
                            {isSelected && <span className="ml-2 text-[8px] text-violet-300 uppercase tracking-widest">Selected</span>}
                          </div>
                          <div className={cn("mt-0.5 font-mono whitespace-pre-wrap break-all", isSelected ? "text-violet-300" : "text-violet-400")}>{value}</div>
                        </button>
                      </HoverTooltip>
                    );
                  })}
                  {(endpointFilter === "all" || endpointFilter === "compute") && filteredVmTargets.map(vm => {
                    const value = `http://${vm.externalIp}`;
                    const isSelected = isEndpointSelected(value);
                    return (
                      <HoverTooltip
                        key={`vm-${vm.name}-${vm.externalIp}`}
                        content={
                          <>
                            <div className="text-cyan-300 font-bold uppercase tracking-widest text-[8px] mb-1">{vm.name}</div>
                            <div className="text-sky-300 font-mono">{value}</div>
                            <div className="text-slate-500 mt-1">{vm.zone.split("/").pop() ?? vm.zone}</div>
                          </>
                        }
                      >
                        <button onClick={() => toggleEndpointSelection(value)}
                          className={cn(
                            "w-full text-left text-[10px] px-2 py-1.5 transition-colors rounded-sm relative overflow-hidden",
                            isSelected
                              ? "bg-cyan-950/55 ring-2 ring-cyan-500/80 border border-cyan-500/35 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]"
                              : "bg-[#0a0a0a]/60 hover:bg-[#0c1113]"
                          )}
                        >
                          <div className={cn("break-words", isSelected ? "text-slate-200" : "text-slate-400")}>
                            {vm.name}
                            {isSelected && <span className="ml-2 text-[8px] text-cyan-300 uppercase tracking-widest">Selected</span>}
                          </div>
                          <div className={cn("mt-0.5 font-mono whitespace-pre-wrap break-all", isSelected ? "text-cyan-300" : "text-cyan-400")}>{value}</div>
                        </button>
                      </HoverTooltip>
                    );
                  })}
                  {(endpointFilter === "all" || endpointFilter === "cloudrun") && filteredCloudRunServices.length > 0 && (
                    <div className="text-[9px] uppercase tracking-widest text-slate-600 px-1 pt-1">Cloud Run</div>
                  )}
                  {(endpointFilter === "all" || endpointFilter === "cloudrun") && filteredCloudRunServices.map(s => {
                    const value = s.url!;
                    const isSelected = isEndpointSelected(value);
                    return (
                      <HoverTooltip
                        key={`run-${s.url}`}
                        content={
                          <>
                            <div className="text-emerald-400 font-bold uppercase tracking-widest text-[8px] mb-1">{s.name}</div>
                            <div className="text-sky-300 font-mono break-all">{s.url}</div>
                          </>
                        }
                      >
                        <button onClick={() => toggleEndpointSelection(value)}
                          className={cn(
                            "w-full text-left text-[10px] px-2 py-1.5 transition-colors rounded-sm relative overflow-hidden",
                            isSelected
                              ? "bg-emerald-950/60 ring-2 ring-emerald-500/80 border border-emerald-500/35 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.22)]"
                              : "bg-[#0a0a0a]/60 hover:bg-[#0c120d]"
                          )}
                        >
                          <div className={cn("break-words", isSelected ? "text-slate-200" : "text-slate-400")}>
                            {s.name}
                            {isSelected && <span className="ml-2 text-[8px] text-emerald-300 uppercase tracking-widest">Selected</span>}
                          </div>
                          <div className={cn("mt-0.5 font-mono whitespace-pre-wrap break-all", isSelected ? "text-emerald-300" : "text-emerald-400")}>{s.url}</div>
                        </button>
                      </HoverTooltip>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Body */}
          {method !== "GET" && method !== ("HEAD" as string) && (
            <div className="flex flex-col gap-1">
              <div className="text-[9px] uppercase tracking-widest text-slate-600">Body (JSON)</div>
              <textarea
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                rows={6}
                className="w-full px-2 py-2 bg-[#0d0d0d] border border-slate-800 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-800 resize-y no-scrollbar"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Fixed bottom: send + status */}
        <div className="shrink-0 flex flex-col gap-2">
          <button
            onClick={handleSend}
            disabled={sending || !url.trim()}
            className={cn(
              "flex items-center justify-center gap-2 py-2.5 text-xs font-bold tracking-widest uppercase transition-all",
              sending || !url.trim()
                ? "border border-slate-800 text-slate-600 cursor-not-allowed"
                : "border border-emerald-600 text-emerald-400 hover:bg-emerald-900/20 hover:shadow-lg hover:shadow-emerald-500/10"
            )}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {sending ? "SENDING..." : "SEND REQUEST"}
          </button>

          <div className="flex items-center justify-between text-[9px] text-slate-600">
            <span>
              {loadingSnapshot ? "Loading topology…" :
               snapshot ? `${nodes.length - 1} resources` : "No snapshot"}
              {!loadingSnapshot && loadingEntryPoints && " · scanning…"}
              {!loadingSnapshot && !loadingEntryPoints && entryPoints.length > 0 && ` · ${entryPoints.length} entry pts`}
            </span>
            <button onClick={fetchSnapshot} className="hover:text-slate-400 transition-colors">
              <RefreshCw size={10} className={loadingSnapshot ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>}

      {/* ── Center: Infrastructure graph ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 border border-slate-800/50 bg-[#070b07] overflow-hidden">
        {/* Column headers + zoom controls */}
        <div className="flex border-b border-slate-800/50 shrink-0 items-stretch">
          {(nodes.some(n => n.type === "sidecar")
            ? ["INTERNET", "EDGE / LB", "COMPUTE", "SERVICES"]
            : ["INTERNET", "EDGE / LB", "COMPUTE", "DATA"]
          ).map((label, i) => (
            <div key={i} className="flex-1 text-center py-1.5 text-[9px] tracking-widest uppercase text-slate-600 border-r border-slate-800/30">
              {label}
            </div>
          ))}
          <div className="flex items-center gap-0.5 px-2 border-l border-slate-800/30 shrink-0">
            {/* Live monitor toggle */}
            {(demoMode || liveMonitorTarget) && (
              <>
                <button
                  onClick={() => {
                    const next = !liveMode;
                    liveModeRef.current = next;
                    setLiveMode(next);
                    if (!next) setNodeStatus({});
                  }}
                  title={liveMode ? "Stop live monitoring" : `Watch for incoming requests via ${traceSourceLabel}`}
                  className={cn(
                    "flex items-center gap-1 text-[8px] px-1.5 py-0.5 border transition-colors font-bold tracking-widest",
                    liveMode
                      ? "border-emerald-600 text-emerald-400 bg-emerald-900/20"
                      : "border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400"
                  )}
                  >
                    <Activity size={8} className={liveMode ? "animate-pulse" : ""} />
                    LIVE
                    {liveMode && liveRps !== null && (
                      <span className="font-mono text-emerald-300">
                        {liveRps >= 10 ? liveRps.toFixed(0) : liveRps.toFixed(1)}/s
                      </span>
                    )}
                  </button>
                {showTraceSetupHint && (
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[8px] px-1.5 py-0.5 border tracking-widest",
                      traceSourceConfig?.setupState === "terraform_generated"
                        ? "border-amber-800 text-amber-400 bg-amber-950/20"
                        : "border-sky-800 text-sky-400 bg-sky-950/30"
                    )}
                    title={traceSourceConfig?.lastCheckMessage}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                    SETUP
                  </div>
                )}
                {((demoMode ? demoLiveTargets.length : allLiveMonitorTargets.length) > 1) && (
                  <button
                    onClick={() => setLiveScope(scope => scope === "all" ? "active" : "all")}
                    title={liveScope === "all" ? "Watching all monitorable endpoints" : "Watch all monitorable endpoints"}
                    className={cn(
                      "flex items-center gap-1 text-[8px] px-1.5 py-0.5 border transition-colors tracking-widest",
                      liveScope === "all"
                        ? "border-emerald-800 text-emerald-500 bg-emerald-950/30"
                        : "border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400"
                    )}
                    >
                    <Globe size={8} />
                    ALL
                  </button>
                )}
                {liveMode && (
                  <button
                    onClick={() => {
                      const next = !liveAnimEnabled;
                      liveAnimEnabledRef.current = next;
                      setLiveAnimEnabled(next);
                      if (!next) setNodeStatus({});
                    }}
                    title={liveAnimEnabled ? "Disable pulse animation" : "Enable pulse animation"}
                    className={cn(
                      "flex items-center gap-1 text-[8px] px-1.5 py-0.5 border transition-colors tracking-widest",
                      liveAnimEnabled
                        ? "border-emerald-800 text-emerald-600 hover:border-emerald-700"
                        : "border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400"
                    )}
                    >
                    <Zap size={8} />
                    ANIM
                  </button>
                )}
                {/* Adaptive intensity styling is currently hidden from the UI. */}
                <div className="w-px h-3 bg-slate-800 mx-0.5" />
              </>
            )}
            {demoMode && demoRps !== null && (
              <>
                <span className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 border border-emerald-900 text-emerald-500 font-bold tracking-widest">
                  <Activity size={8} className="animate-pulse" />
                  SIM
                  <span className="font-mono text-emerald-300">{demoRps >= 10 ? demoRps.toFixed(0) : demoRps.toFixed(1)}/s</span>
                </span>
                <span className="text-[8px] text-slate-600 font-mono">{demoRequestCount} reqs</span>
                <div className="w-px h-3 bg-slate-800 mx-0.5" />
              </>
            )}
            <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="p-1 text-slate-600 hover:text-slate-300 transition-colors" title="Zoom in"><ZoomIn size={11} /></button>
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} className="p-1 text-slate-600 hover:text-slate-300 transition-colors" title="Zoom out"><ZoomOut size={11} /></button>
            <button onClick={resetView} className="p-1 text-slate-600 hover:text-slate-300 transition-colors" title="Reset view"><Maximize2 size={11} /></button>
            <span className="text-[9px] text-slate-700 w-7 text-right">{Math.round(zoom * 100)}%</span>
            <div className="w-px h-3 bg-slate-800 mx-1" />
            <button
              onClick={() => setGraphFullscreen(f => !f)}
              className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
              title={graphFullscreen ? "Exit fullscreen" : "Fullscreen graph"}
            >
              {graphFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
          </div>
        </div>

        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ height: graphH }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Zoom/pan wrapper */}
          <div
            onClick={() => { if (!hasDraggedRef.current) { setSelectedNode(null); setShowResponse(true); } }}
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
            }}
          >
          {/* SVG connections */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={containerSize.w}
            height={graphH}
            viewBox={`0 0 ${containerSize.w} ${graphH}`}
            overflow="visible"
          >
            <defs>
              <filter id="pulse-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {lines.map(line => {
              const fromActive = activePath.has(line.fromId);
              const toActive = activePath.has(line.toId);
              const isLit = nodeStatus[line.fromId] === "done" || nodeStatus[line.fromId] === "active";
              const isPath = fromActive && toActive;
              const concurrentBursts = livePulseBursts.filter(
                burst => burst.pathIds.has(line.fromId) && burst.pathIds.has(line.toId)
              );
              // Show pulse when line is in the URL-matched path OR when both endpoints
              // are actively being animated (e.g. live mode with no URL typed)
              const bothAnimated = nodeStatus[line.fromId] !== undefined && nodeStatus[line.toId] !== undefined;
              // Keep edge visibility consistent with node visibility.
              // When a URL is focused, only show edges whose endpoints are both
              // part of the inferred path; otherwise "internet" keeps every
              // outbound edge faintly visible because it is always active.
              const useIntensityStyling = liveIntensityEnabled;
              const lineActivity = useIntensityStyling
                ? requestActivityIntensity * (isPath || concurrentBursts.length > 0 ? 1 : 0.55)
                : 0;
              const pulseGlowOpacity = useIntensityStyling ? 0.18 + lineActivity * 0.28 : 0.25;
              const pulseCoreOpacity = useIntensityStyling ? 0.88 + lineActivity * 0.08 : 0.95;
              const pulseGlowWidth = useIntensityStyling ? 5 + lineActivity * 2.5 : 6;
              const pulseCoreWidth = useIntensityStyling ? 1.8 + lineActivity * 0.85 : 2;
              const pulseDuration = useIntensityStyling ? Math.max(0.22, 0.38 - lineActivity * 0.12) : 0.38;
              const lineVisible = !url.trim() || isPath || concurrentBursts.length > 0;

              return (
                <g key={line.id} opacity={lineVisible ? 1 : 0}>
                  {/* Base path */}
                  <path
                    d={bezierPath(line)}
                    fill="none"
                    stroke={isPath ? "#1a3a1a" : "#111"}
                    strokeWidth={1.5}
                    strokeDasharray={!url.trim() || isPath ? "none" : "4 4"}
                  />
                  {/* Animated pulse — glowing bolt along the line */}
                  {isLit && (isPath || bothAnimated) && (
                    <>
                      {/* Glow layer */}
                      <motion.path
                        key={`glow-${line.id}-${sending}`}
                        d={bezierPath(line)}
                        fill="none"
                        stroke="#00ff41"
                        strokeWidth={pulseGlowWidth}
                        strokeLinecap="round"
                        opacity={pulseGlowOpacity}
                        filter="url(#pulse-glow)"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: pulseDuration, ease: "easeOut" }}
                      />
                      {/* Sharp core */}
                      <motion.path
                        key={`flow-${line.id}-${sending}`}
                        d={bezierPath(line)}
                        fill="none"
                        stroke="#00ff41"
                        strokeWidth={pulseCoreWidth}
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: pulseCoreOpacity }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: Math.max(0.2, pulseDuration - 0.03), ease: "easeOut" }}
                      />
                    </>
                  )}
                  {concurrentBursts.map((burst) => (
                    <g key={burst.id}>
                      <motion.path
                        d={bezierPath(line)}
                        fill="none"
                        stroke="#00ff41"
                        strokeWidth={pulseGlowWidth + 0.5}
                        strokeLinecap="round"
                        opacity={pulseGlowOpacity}
                        filter="url(#pulse-glow)"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: Math.max(0.22, pulseDuration + 0.02), ease: "easeOut" }}
                      />
                      <motion.path
                        d={bezierPath(line)}
                        fill="none"
                        stroke="#00ff41"
                        strokeWidth={pulseCoreWidth}
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: pulseCoreOpacity }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: Math.max(0.2, pulseDuration - 0.01), ease: "easeOut" }}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const p = pos[node.id];
            if (!p) return null;
            const meta = node.type === "sidecar" && node.container
              ? { ...NODE_META.sidecar, ...getContainerMeta(node.container) }
              : NODE_META[node.type];
            const status = nodeStatus[node.id] ?? "idle";
            const isSelected = selectedNode?.id === node.id;
            const inPath = activePath.has(node.id);
            const graphFocusActive = false;

            const isBeingDragged = draggingNodeId === node.id;

            return (
              <motion.div
                key={node.id}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const cp = pos[node.id];
                  nodeDragRef.current = { nodeId: node.id, startX: e.clientX, startY: e.clientY, startCx: cp.cx, startCy: cp.cy, moved: false };
                  setDraggingNodeId(node.id);
                }}
                onPointerMove={e => {
                  const d = nodeDragRef.current;
                  if (!d || d.nodeId !== node.id) return;
                  const dx = (e.clientX - d.startX) / zoom;
                  const dy = (e.clientY - d.startY) / zoom;
                  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                    d.moved = true;
                    setNodePositions(prev => ({ ...prev, [node.id]: { cx: d.startCx + dx, cy: d.startCy + dy } }));
                  }
                }}
                onPointerUp={e => {
                  const d = nodeDragRef.current;
                  if (!d || d.nodeId !== node.id) return;
                  nodeDragRef.current = null;
                  setDraggingNodeId(null);
                  if (!d.moved && selectedNode?.id !== node.id) {
                    setSelectedNode(node);
                  }
                }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setNodePositions(prev => { const next = { ...prev }; delete next[node.id]; return next; });
                }}
                onClick={e => e.stopPropagation()}
                onMouseEnter={graphFullscreen ? () => setHoveredNode(node) : undefined}
                onMouseLeave={graphFullscreen ? () => setHoveredNode(null) : undefined}
                style={{
                  position: "absolute",
                  left: p.cx - NODE_W / 2,
                  top: p.cy - NODE_H / 2,
                  width: NODE_W,
                  height: NODE_H,
                }}
                animate={{
                  opacity: inPath ? 1 : (url.trim() ? 0 : 0.3),
                  scale: status === "active" ? 1.04 : isBeingDragged ? 1.06 : isSelected ? 1.01 : 1,
                }}
                transition={{ duration: isSelected ? 0.3 : 0.15, ease: "easeOut" }}
                className={cn(
                  "border flex items-center gap-2.5 px-3 select-none transition-[opacity,transform,box-shadow,border-color,background-color] duration-300 ease-out",
                  isBeingDragged ? "cursor-grabbing shadow-xl shadow-black/40" : "cursor-grab",
                  STATUS_OVERLAY[status],
                  status === "active" && "shadow-lg shadow-emerald-500/20",
                  status === "done" && meta.border,
                  status === "error" && "border-red-700",
                  isSelected && "border-emerald-300/65 bg-emerald-950/30 shadow-[0_0_34px_rgba(16,185,129,0.26),0_0_82px_rgba(16,185,129,0.14)]",
                )}
              >
                {/* Icon */}
                <div className={cn(
                  "shrink-0 p-1.5 border",
                  status === "idle" ? "border-slate-800 text-slate-600" :
                  status === "active" ? `${meta.border} ${meta.text}` :
                  status === "done" ? `${meta.border} ${meta.text} opacity-80` :
                  "border-red-800 text-red-400"
                )}>
                  {status === "active" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : status === "done" ? (
                    <CheckCircle2 size={14} />
                  ) : status === "error" ? (
                    <XCircle size={14} />
                  ) : (
                    <meta.Icon size={14} />
                  )}
                </div>

                {/* Labels */}
                <div className="min-w-0">
                  <div className={cn(
                    "text-[10px] font-bold tracking-wide truncate",
                    status === "idle" ? "text-slate-500" :
                    status === "active" ? "text-white" :
                    status === "done" ? meta.text :
                    "text-red-400"
                  )}>
                    {node.label}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[9px] text-slate-600 truncate">{node.sublabel}</span>
                    {istioNodes.has(node.id) && (
                      <span className="shrink-0 flex items-center gap-0.5 text-[7px] text-violet-400 border border-violet-800/60 px-0.5 rounded" title="Istio service mesh · mTLS enabled">
                        <Shield size={6} />mTLS
                      </span>
                    )}
                  </div>
                </div>

                {/* Status badge */}
                {status === "done" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-auto shrink-0"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </motion.div>
                )}
                {status === "active" && (
                  <div className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </motion.div>
            );
          })}
          </div>{/* end zoom/pan wrapper */}

          {/* Live RPS overlay */}
          <AnimatePresence>
            {liveMode && liveRps !== null && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute bottom-3 left-3 pointer-events-none flex items-baseline gap-1.5 border border-emerald-900/60 bg-[#020a02]/80 px-2.5 py-1.5 backdrop-blur-sm"
              >
                <span className={cn(
                  "font-mono font-bold leading-none",
                  liveRps >= 50 ? "text-red-400 text-2xl" :
                  liveRps >= 10 ? "text-amber-400 text-2xl" :
                  "text-emerald-400 text-2xl"
                )}>
                  {liveRps >= 10 ? liveRps.toFixed(0) : liveRps.toFixed(1)}
                </span>
                <span className="text-[9px] text-slate-500 uppercase tracking-widest">req/s</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hover tooltip — fullscreen only */}
          <AnimatePresence>
            {graphFullscreen && hoveredNode && hoveredNode.id !== selectedNode?.id && (
              <motion.div
                key={`tt-${hoveredNode.id}`}
                initial={{ opacity: 0, scale: 0.95, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="absolute z-20 pointer-events-none border border-slate-700/80 bg-[#0a0d0a]/95 backdrop-blur-sm px-3 py-2 w-52 shadow-xl"
                style={{
                  left: Math.min(cursorInContainer.x + 16, containerSize.w - 216),
                  top: Math.max(cursorInContainer.y - 20, 4),
                }}
              >
                {(() => {
                  const m = NODE_META[hoveredNode.type];
                  const st = nodeStatus[hoveredNode.id] ?? "idle";
                  return (
                    <>
                      <div className="flex items-center gap-1.5 mb-1">
                        <m.Icon size={10} className={m.text} />
                        <span className="text-[9px] font-bold text-slate-200 uppercase tracking-wide truncate">{hoveredNode.label}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 mb-0.5">{NODE_TYPE_LABEL[hoveredNode.type]}</div>
                      {hoveredNode.sublabel && <div className="text-[9px] text-slate-600 font-mono truncate">{hoveredNode.sublabel}</div>}
                      {st !== "idle" && (
                        <div className={cn("text-[8px] font-bold mt-1.5 uppercase",
                          st === "done" ? "text-emerald-400" :
                          st === "active" ? "text-emerald-300 animate-pulse" : "text-red-400"
                        )}>{st === "active" ? "IN FLIGHT" : st === "done" ? "OK" : "FAILED"}</div>
                      )}
                      <div className="text-[8px] text-slate-700 mt-1.5">Click for details</div>
                    </>
                  );
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom timing bar */}
        <AnimatePresence>
          {response && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-slate-800/50 text-[10px]"
            >
              <HoverTooltip
                content={`HTTP ${response.status ?? "ERROR"}${response.statusText ? ` ${response.statusText}` : ""}`}
              >
                <span className={cn("font-bold", statusColor(response.status))}>
                  {response.status ? `${response.status} ${response.statusText}` : "ERROR"}
                </span>
              </HoverTooltip>
              <HoverTooltip content={`Response time: ${response.timing}ms`}>
                <span className="text-slate-500">{response.timing}ms</span>
              </HoverTooltip>
              {response.error && (
                <HoverTooltip content={response.error}>
                  <span className="text-red-400 truncate">{response.error}</span>
                </HoverTooltip>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── NodeDetail slide-in panel ───────────────────────────────── */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            key={selectedNode.id}
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="fixed top-4 right-4 bottom-4 w-[280px] flex flex-col border border-slate-700/60 bg-[#070b07]/95 backdrop-blur-md shadow-2xl shadow-black/60 overflow-hidden z-[60]"
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          >
            <NodeDetail
              node={selectedNode}
              status={nodeStatus[selectedNode.id] ?? "idle"}
              inPath={activePath.has(selectedNode.id)}
              response={response}
              url={url}
              method={method}
              onClose={() => { setSelectedNode(null); setShowResponse(true); }}
              onIstioDetected={handleIstioDetected}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Request Trace modal ───────────────────────────────────────── */}
      <AnimatePresence>
        {showTrace && requestTime && (
          <TraceModal
            requestTime={requestTime}
            nodeContainers={nodeContainers}
            gkeNodes={baseNodes.filter(n => n.type === "gke" && n.projectId)}
            onClose={() => setShowTrace(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedLiveEvent && (
          <LiveEventDetail
            event={selectedLiveEvent}
            nodes={nodes}
            edges={edges}
            onClose={() => setSelectedLiveEvent(null)}
            onSelectNode={(node) => {
              setSelectedLiveEvent(null);
              openNodeDetail(node);
            }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
