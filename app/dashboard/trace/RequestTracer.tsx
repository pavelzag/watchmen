"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Server, Box, Database, Play, Loader2,
  Cloud, CheckCircle2, XCircle, ChevronDown, RefreshCw,
  ZoomIn, ZoomOut, Maximize2, Minimize2, X, Info, Cpu, Copy, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GcpSnapshot, GkeEntryPoint } from "@/lib/gcp/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 172;
const NODE_H = 68;
const NODE_GAP = 14;
const COL_PADDING_X = 24;
const ROW_PADDING_Y = 40;
const ANIM_COL_DELAY = 320; // ms between columns
const ANIM_PULSE_MS = 260;  // ms node stays "active" before "done"

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = "internet" | "lb" | "gke" | "cloudrun" | "cloudsql" | "vm";
type NodeStatus = "idle" | "active" | "done" | "error";

interface GraphNode {
  id: string;
  type: NodeType;
  col: number;
  label: string;
  sublabel: string;
  projectId?: string;
  region?: string;   // Cloud Run region or GCE zone — used for log filtering
  matchUrl?: string; // Cloud Run URL or LB IP
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

function buildSvgLines(
  edges: GraphEdge[],
  pos: Record<string, { cx: number; cy: number }>,
): SvgLine[] {
  return edges.map(e => {
    const from = pos[e.from];
    const to = pos[e.to];
    if (!from || !to) return null;
    return {
      id: `${e.from}__${e.to}`,
      fromId: e.from,
      toId: e.to,
      x1: from.cx + NODE_W / 2,
      y1: from.cy,
      x2: to.cx - NODE_W / 2,
      y2: to.cy,
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
};

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
const METHOD_COLOR: Record<string, string> = {
  GET: "text-sky-400", POST: "text-emerald-400", PUT: "text-amber-400",
  PATCH: "text-orange-400", DELETE: "text-red-400",
};

// ─── Node type labels ─────────────────────────────────────────────────────────

const NODE_TYPE_LABEL: Record<NodeType, string> = {
  internet:  "Internet Entry",
  lb:        "Load Balancer",
  gke:       "GKE Cluster",
  cloudrun:  "Cloud Run",
  cloudsql:  "Cloud SQL",
  vm:        "Compute Engine VM",
};

const NODE_ROLE_DESC: Record<NodeType, string> = {
  internet:  "Origin of the outgoing HTTP request.",
  lb:        "GCP external load balancer that forwards traffic to backend services.",
  gke:       "Google Kubernetes Engine cluster running containerised workloads.",
  cloudrun:  "Serverless Cloud Run service — the request is delivered directly here.",
  cloudsql:  "Managed relational database — not reachable via HTTP, accessed internally.",
  vm:        "Compute Engine VM instance — direct or LB-fronted HTTP workload.",
};

// ─── ResponseDetail sub-component ────────────────────────────────────────────

function ResponseDetail({
  response,
  open,
  onToggleHeaders,
}: {
  response: ProxyResponse;
  open: boolean;
  onToggleHeaders: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 border border-slate-800 p-2 bg-[#0d0d0d]">
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
      </div>

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

type NodeDetailTab = "info" | "logs" | "routes";

interface DiscoveredRoute { method: string; path: string; description?: string; body?: Record<string, string> | null; }
interface HttpRequestLog {
  method: string; url: string; status?: number;
  latency: string; remoteIp: string; responseSize: string; userAgent: string;
}
interface LogEntry {
  timestamp: string; severity: string; message: string;
  pod?: string; container?: string; revision?: string; instanceId?: string;
  httpRequest?: HttpRequestLog;
}

function NodeDetail({
  node, status, inPath, response, url, method, onClose,
}: {
  node: GraphNode; status: NodeStatus; inPath: boolean;
  response: ProxyResponse | null; url: string; method: string; onClose: () => void;
}) {
  const meta = NODE_META[node.type];
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
  const hasLogs   = node.type === "gke" || node.type === "cloudrun" || node.type === "vm";
  const hasRoutes = node.type === "gke" || node.type === "cloudrun" || node.type === "lb" || node.type === "vm";
  const showTabs  = hasLogs || hasRoutes;
  const [tab, setTab] = useState<NodeDetailTab>("info");

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState<"all" | "2xx" | "3xx" | "4xx" | "5xx">("all");
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>("");

  // Routes state
  const [routes, setRoutes] = useState<DiscoveredRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routesSource, setRoutesSource] = useState<string | null>(null);

  // Fetch available containers for GKE nodes (for the container selector)
  useEffect(() => {
    if (tab !== "logs" || node.type !== "gke" || !node.projectId) return;
    const params = new URLSearchParams({ projectId: node.projectId, mode: "containers" });
    fetch(`/api/gcp/logs?${params}`)
      .then(r => r.json())
      .then(d => setAvailableContainers(d.containers ?? []))
      .catch(() => {});
  }, [tab, node.id, node.projectId, node.type]);

  // Fetch logs when tab or container selection changes
  useEffect(() => {
    if (tab !== "logs" || !node.projectId) return;
    setLoadingLogs(true);
    setLogsError(null);

    const params = new URLSearchParams({ projectId: node.projectId, limit: "80" });
    if (node.type === "cloudrun") {
      params.set("resourceType", "cloud_run_revision");
      params.set("service", node.label.toLowerCase());
      if (node.region) params.set("region", node.region);
    } else if (node.type === "vm") {
      params.set("resourceType", "gce_instance");
      params.set("instance", node.label.toLowerCase());
      if (node.region) params.set("region", node.region);
    } else {
      params.set("resourceType", "k8s_container");
      if (selectedContainer) {
        params.set("container", selectedContainer);
      } else {
        // Exclude the watchmen app itself — show only service containers
        params.set("excludeContainer", "watchmen");
      }
    }

    fetch(`/api/gcp/logs?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setLogsError(d.error); return; }
        setLogs(d.entries ?? []);
      })
      .catch(e => setLogsError(e.message))
      .finally(() => setLoadingLogs(false));
  }, [tab, node.id, node.projectId, node.type, node.label, node.region, selectedContainer]);

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
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      const parsed = !l.httpRequest ? (parseReqLog(l.message) ?? parseNginxLog(l.message) ?? parseEnvoyLog(l.message)) : null;
      const status = l.httpRequest?.status ?? parsed?.status;
      const searchable = l.httpRequest
        ? `${l.httpRequest.method} ${l.httpRequest.url} ${l.httpRequest.remoteIp} ${l.httpRequest.userAgent}`
        : parsed
        ? `${parsed.method} ${parsed.path} ${parsed.ip} ${parsed.body ?? ""}`
        : l.message;

      if (logStatusFilter !== "all") {
        if (status === undefined) return false;
        const ranges: Record<string, [number, number]> = { "2xx": [200, 299], "3xx": [300, 399], "4xx": [400, 499], "5xx": [500, 599] };
        const r = ranges[logStatusFilter];
        if (r && (status < r[0] || status > r[1])) return false;
      }
      if (logSearch.trim()) {
        if (!searchable.toLowerCase().includes(logSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, logSearch, logStatusFilter]);

  // Copy logs to clipboard
  const handleCopyLogs = useCallback(() => {
    const text = filteredLogs.map(l => {
      const ts = l.timestamp ? new Date(l.timestamp).toISOString() : "";
      if (l.httpRequest) {
        const hr = l.httpRequest;
        return `${ts}  ${hr.method}  ${hr.status ?? "?"}  ${hr.url}  ${hr.remoteIp}  ${hr.latency}`;
      }
      const parsed = parseReqLog(l.message);
      if (parsed) {
        return `${ts}  ${parsed.method}  ${parsed.status}  ${parsed.path}  ${parsed.ip}  ${parsed.latencyMs}ms${parsed.body ? `  body=${parsed.body}` : ""}`;
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
      if (e.key === "Escape") setLogsExpanded(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tab, handleCopyLogs]);

  const METHOD_COLOR: Record<string, string> = {
    GET: "text-sky-400", POST: "text-emerald-400", PUT: "text-amber-400",
    PATCH: "text-orange-400", DELETE: "text-red-400",
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
                onClick={() => { setLogs([]); setTab("info"); setTimeout(() => setTab("logs"), 0); }}
                title="Refresh"
                className="text-slate-600 hover:text-slate-300 transition-colors"
              ><RefreshCw size={9} /></button>
            </div>

            {/* Container selector (GKE only, shown when multiple containers detected) */}
            {node.type === "gke" && availableContainers.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setSelectedContainer("")}
                  className={cn("text-[8px] px-1.5 py-0.5 border transition-colors",
                    !selectedContainer ? "border-slate-500 text-slate-300 bg-slate-800" : "border-slate-800 text-slate-600 hover:text-slate-400"
                  )}>ALL</button>
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
              {(logSearch || logStatusFilter !== "all") && (
                <span className="text-[8px] text-slate-600 self-center ml-1">{filteredLogs.length}/{logs.length}</span>
              )}
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
                  <div key={i} className="border-b border-slate-800/30 pb-1.5 last:border-0">
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
                  </div>
                );
              }

              // ── Try to parse structured text log ([req], nginx JSON, Envoy) ──
              const parsed = parseReqLog(l.message) ?? parseNginxLog(l.message) ?? parseEnvoyLog(l.message);
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
                  <div key={i} className="border-b border-slate-800/30 pb-1.5 last:border-0">
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
                  </div>
                );
              }

              // ── Plain text / JSON log ──
              const source = l.revision || l.pod || l.instanceId || "";
              return (
                <div key={i} className="border-b border-slate-800/40 pb-1.5 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-[8px] font-bold shrink-0", severityColor)}>{l.severity}</span>
                    {source && <span className="text-[8px] text-slate-700 truncate">{source}</span>}
                    <span className="text-[8px] text-slate-700 ml-auto shrink-0">{ts}</span>
                  </div>
                  {l.message && (
                    <p className="text-[10px] text-slate-400 font-mono break-all leading-relaxed">{l.message}</p>
                  )}
                </div>
              );
            })}

            {filteredLogs.length > 0 && (
              <p className="text-[8px] text-slate-700 text-center">Press <kbd className="bg-slate-800 px-1 rounded text-slate-500">C</kbd> to copy · {filteredLogs.length} entries</p>
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
                    {/* Modal log list */}
                    <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1.5 font-mono text-[10px]">
                      {filteredLogs.map((l, i) => {
                        const ts = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "";
                        const parsed = !l.httpRequest ? parseReqLog(l.message) : null;
                        const status = l.httpRequest?.status ?? parsed?.status;
                        const method = l.httpRequest?.method ?? parsed?.method ?? "";
                        const path = l.httpRequest
                          ? (() => { try { return new URL(l.httpRequest!.url).pathname; } catch { return l.httpRequest!.url; } })()
                          : parsed?.path ?? "";
                        const ip = l.httpRequest?.remoteIp ?? parsed?.ip ?? "";
                        const latency = l.httpRequest?.latency ?? (parsed ? `${parsed.latencyMs}ms` : "");
                        const body = parsed?.body ?? "";
                        const pod = l.pod || l.instanceId || "";
                        const statusC = !status ? "text-slate-400"
                          : status < 300 ? "text-emerald-400"
                          : status < 400 ? "text-sky-400"
                          : status < 500 ? "text-amber-400" : "text-red-400";
                        const methodColor = METHOD_COLOR[method] ?? "text-slate-400";
                        if (method) return (
                          <div key={i} className="flex items-baseline gap-2 border-b border-slate-800/30 pb-1 last:border-0">
                            <span className="text-slate-700 shrink-0 w-16">{ts}</span>
                            <span className={cn("shrink-0 w-10 font-bold", methodColor)}>{method}</span>
                            <span className={cn("shrink-0 w-8 font-bold", statusC)}>{status ?? "?"}</span>
                            <span className="text-white flex-1 truncate">{path}</span>
                            <span className="text-slate-600 shrink-0">{ip}</span>
                            <span className="text-slate-700 shrink-0">{latency}</span>
                            {body && <span className="text-slate-700 truncate max-w-[200px]" title={body}>{body}</span>}
                          </div>
                        );
                        return (
                          <div key={i} className="flex items-baseline gap-2 border-b border-slate-800/30 pb-1 last:border-0">
                            <span className="text-slate-700 shrink-0 w-16">{ts}</span>
                            {pod && <span className="text-slate-700 shrink-0 truncate max-w-[120px]">{pod}</span>}
                            <span className="text-slate-400 flex-1 break-all">{l.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                </motion.div>
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

export default function RequestTracer() {
  // Snapshot + topology
  const [snapshot, setSnapshot] = useState<GcpSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [entryPoints, setEntryPoints] = useState<GkeEntryPoint[]>([]);
  const [loadingEntryPoints, setLoadingEntryPoints] = useState(true);

  // Topology derived from snapshot + entry points — auto-updates when either changes
  const { nodes, edges } = useMemo(
    () => buildTopology(snapshot, entryPoints),
    [snapshot, entryPoints],
  );

  // Layout
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 360 });

  // Request form
  const [method, setMethod] = useState<typeof METHODS[number]>("POST");
  const [url, setUrl] = useState("");
  const [bodyText, setBodyText] = useState('{\n  "key": "value"\n}');
  const [methodOpen, setMethodOpen] = useState(false);

  // Send state
  const [sending, setSending] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<Record<string, NodeStatus>>({});
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);

  // Node selection
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Fullscreen graph
  const [graphFullscreen, setGraphFullscreen] = useState(false);

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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.3, z - e.deltaY * 0.001)));
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setGraphFullscreen(false); setSelectedNode(null); }
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
  const pos = useMemo(() => ({ ...basePos, ...nodePositions }), [basePos, nodePositions]);
  const lines = useMemo(() => buildSvgLines(edges, pos), [edges, pos]);
  const activePath = inferActivePath(url, nodes, edges);

  // ── Send request ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (sending || !url.trim()) return;
    setSending(true);
    setResponse(null);

    // Build ordered animation path: cols 0→1→2→3
    const pathNodes = nodes
      .filter(n => activePath.has(n.id))
      .sort((a, b) => a.col - b.col || a.id.localeCompare(b.id));

    // Reset status
    setNodeStatus({});

    // Start HTTP request immediately (parallel with animation)
    let parsedBody: any = undefined;
    if (method !== "GET" && method !== ("HEAD" as string) && bodyText.trim()) {
      const p = tryParseJson(bodyText);
      parsedBody = p.ok ? p.val : bodyText;
    }

    const httpPromise = fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim(), method, body: parsedBody }),
    }).then(r => r.json() as Promise<ProxyResponse>);

    // Animate columns
    let prevCol = -1;
    for (const node of pathNodes) {
      if (node.col > prevCol) {
        if (prevCol >= 0) await sleep(ANIM_COL_DELAY);
        prevCol = node.col;
      }
      setNodeStatus(prev => ({ ...prev, [node.id]: "active" }));
    }

    await sleep(ANIM_PULSE_MS);

    // Mark all path nodes done
    setNodeStatus(prev => {
      const next = { ...prev };
      pathNodes.forEach(n => { next[n.id] = "done"; });
      return next;
    });

    // Wait for HTTP response
    try {
      const result = await httpPromise;
      setResponse(result);
      if (!result.ok && result.error) {
        // Mark last compute/cloudrun node as error
        const lastNode = [...pathNodes].reverse().find(n => n.col >= 2);
        if (lastNode) {
          setNodeStatus(prev => ({ ...prev, [lastNode.id]: "error" }));
        }
      }
    } catch (err: any) {
      setResponse({ ok: false, error: err.message, timing: 0 });
    }

    setSending(false);
  }, [sending, url, method, bodyText, nodes, activePath]);

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
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 min-w-0 px-2 py-2 bg-[#0d0d0d] border border-slate-800 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-800"
            />
          </div>
        </div>

        {/* Scrollable middle: targets + body */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">

          {/* URL suggestions */}
          {(loadingEntryPoints || snapshot || entryPoints.length > 0) && (
            <div className="flex flex-col gap-1">
              {loadingEntryPoints ? (
                <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-slate-600">
                  <Loader2 size={9} className="animate-spin shrink-0" />
                  <span>Scanning GKE entry points…</span>
                </div>
              ) : entryPoints.length > 0 && (
                <div className="text-[9px] uppercase tracking-widest text-slate-600 px-1">GKE Entry Points</div>
              )}
              {!loadingEntryPoints && entryPoints.filter(ep => ep.type !== "master-api").map(ep => {
                const proto = "http";
                const value = `${proto}://${ep.ip}`;
                const svcLabel = ep.k8sService ? ` · ${ep.k8sService}` : "";
                const label = `${ep.clusterName}${svcLabel}`;
                const typeTag = ep.type === "master-api" ? "API" : ep.type === "ingress" ? "ING" : "LB";
                return (
                  <button key={`ep-${ep.clusterName}-${ep.ip}-${ep.type}`} onClick={() => setUrl(value)}
                    className="text-left text-[10px] px-2 py-1 border border-slate-800/50 bg-[#0a0a0a] hover:border-emerald-800/60 truncate"
                  >
                    <span className="text-[8px] font-bold text-emerald-700 mr-1.5 border border-emerald-900 px-1 py-px">{typeTag}</span>
                    <span className="text-slate-500 mr-1">{label}</span>
                    <span className="text-sky-400">{value}</span>
                    {ep.isPublic && <span className="ml-1 text-[8px] text-amber-600">PUB</span>}
                  </button>
                );
              })}
              {snapshot && (
                <>
                  {((snapshot.loadBalancers ?? []).filter(lb => lb.ipAddress).length > 0 ||
                    (snapshot.cloudRunServices ?? []).filter(s => s.url).length > 0) && (
                    <div className="text-[9px] uppercase tracking-widest text-slate-600 px-1 pt-1">Other Targets</div>
                  )}
                  {(snapshot.loadBalancers ?? []).filter(lb => lb.ipAddress).map(lb => (
                    <button key={`lb-${lb.ipAddress}`} onClick={() => setUrl(`http://${lb.ipAddress}`)}
                      className="text-left text-[10px] px-2 py-1 border border-slate-800/50 bg-[#0a0a0a] hover:border-slate-700 truncate"
                    >
                      <span className="text-slate-500 mr-1">LB: {lb.name}</span>
                      <span className="text-violet-400">{`http://${lb.ipAddress}`}</span>
                    </button>
                  ))}
                  {(snapshot.cloudRunServices ?? []).filter(s => s.url).map(s => (
                    <button key={`run-${s.url}`} onClick={() => setUrl(s.url!)}
                      className="text-left text-[10px] px-2 py-1 border border-slate-800/50 bg-[#0a0a0a] hover:border-slate-700 truncate"
                    >
                      <span className="text-slate-500 mr-1">Run: {s.name}</span>
                      <span className="text-emerald-400">{s.url}</span>
                    </button>
                  ))}
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
                className="w-full px-2 py-2 bg-[#0d0d0d] border border-slate-800 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-800 resize-y"
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
          {["INTERNET", "EDGE / LB", "COMPUTE", "DATA"].map((label, i) => (
            <div key={i} className="flex-1 text-center py-1.5 text-[9px] tracking-widest uppercase text-slate-600 border-r border-slate-800/30">
              {label}
            </div>
          ))}
          <div className="flex items-center gap-0.5 px-2 border-l border-slate-800/30 shrink-0">
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
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Zoom/pan wrapper */}
          <div
            onClick={() => { if (!hasDraggedRef.current) setSelectedNode(null); }}
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
            {lines.map(line => {
              const fromActive = activePath.has(line.fromId);
              const toActive = activePath.has(line.toId);
              const isLit = nodeStatus[line.fromId] === "done" || nodeStatus[line.fromId] === "active";
              const isPath = fromActive && toActive;

              const lineVisible = !url.trim() || isPath || fromActive || toActive;

              return (
                <g key={line.id} opacity={lineVisible ? 1 : 0}>
                  {/* Base path */}
                  <path
                    d={bezierPath(line)}
                    fill="none"
                    stroke={isPath ? "#1a3a1a" : "#111"}
                    strokeWidth={1.5}
                    strokeDasharray={isPath ? "none" : "4 4"}
                  />
                  {/* Animated flow */}
                  {isLit && isPath && (
                    <motion.path
                      key={`flow-${line.id}-${sending}`}
                      d={bezierPath(line)}
                      fill="none"
                      stroke="#00ff41"
                      strokeWidth={2}
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0.9 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const p = pos[node.id];
            if (!p) return null;
            const meta = NODE_META[node.type];
            const status = nodeStatus[node.id] ?? "idle";
            const inPath = activePath.has(node.id);
            const isSelected = selectedNode?.id === node.id;

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
                  if (!d.moved) setSelectedNode(n => n?.id === node.id ? null : node);
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
                  scale: status === "active" ? 1.04 : isBeingDragged ? 1.06 : 1,
                }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "border flex items-center gap-2.5 px-3 select-none transition-colors duration-200",
                  isBeingDragged ? "cursor-grabbing shadow-xl shadow-black/40" : "cursor-grab",
                  STATUS_OVERLAY[status],
                  status === "active" && "shadow-lg shadow-emerald-500/20",
                  status === "done" && meta.border,
                  status === "error" && "border-red-700",
                  isSelected && "ring-1 ring-white/20",
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
                  <div className="text-[9px] text-slate-600 truncate mt-0.5">{node.sublabel}</div>
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
              <span className={cn("font-bold", statusColor(response.status))}>
                {response.status ? `${response.status} ${response.statusText}` : "ERROR"}
              </span>
              <span className="text-slate-500">{response.timing}ms</span>
              {response.error && <span className="text-red-400 truncate">{response.error}</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Right: Detail / Response panel ───────────────────────────── */}
      {!graphFullscreen && <div className="w-[260px] shrink-0 flex flex-col border border-slate-800/50 bg-[#070b07] min-h-0">

        {selectedNode ? (
          // ── Node detail view ──────────────────────────────────────────
          <NodeDetail
            node={selectedNode}
            status={nodeStatus[selectedNode.id] ?? "idle"}
            inPath={activePath.has(selectedNode.id)}
            response={response}
            url={url}
            method={method}
            onClose={() => setSelectedNode(null)}
          />
        ) : (
          // ── Response view (default) ───────────────────────────────────
          <>
            <div className="shrink-0 px-3 py-2 border-b border-slate-800/50 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Response</span>
              {response?.status && (
                <span className={cn("text-xs font-bold font-mono", statusColor(response.status))}>
                  {response.status}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 text-[11px] font-mono">
              {!response && !sending && (
                <p className="text-slate-600 text-[10px]">
                  Click a node for details, or send a request to see the response.
                </p>
              )}

              {sending && (
                <div className="flex items-center gap-2 text-emerald-500">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px]">Routing request…</span>
                </div>
              )}

              {response && <ResponseDetail response={response} open={responseOpen} onToggleHeaders={() => setResponseOpen(o => !o)} />}
            </div>
          </>
        )}
      </div>}

      {/* ── Fullscreen NodeDetail slide-in panel ──────────────────────── */}
      <AnimatePresence>
        {graphFullscreen && selectedNode && (
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
              onClose={() => setSelectedNode(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
