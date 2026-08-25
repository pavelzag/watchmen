"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Globe2,
  Maximize2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  RuntimeRequestEvent,
  RuntimeSecurityAction,
  RuntimeSecurityRule,
  RuntimeSecurityRuleCondition,
  RuntimeSecuritySeverity,
} from "@/lib/runtime-security";

type RuntimeTab = "requests" | "alerts" | "rules";
type RuntimeMapWindow = "1m" | "5m" | "15m" | "1h" | "all";
type GlobePoint = {
  event: RuntimeRequestEvent;
  x: number;
  y: number;
  lat: number;
  lon: number;
  region: string;
  locationQuality: "source_geo" | "approximate";
};
type GlobeCluster = {
  id: string;
  event: RuntimeRequestEvent;
  events: RuntimeRequestEvent[];
  x: number;
  y: number;
  lat: number;
  lon: number;
  region: string;
  locationQuality: "source_geo" | "approximate";
  count: number;
  decision: RuntimeRequestEvent["decision"];
};
type RuntimeMapMarker = {
  remove: () => void;
  element: HTMLElement;
  visual: HTMLElement;
  cluster: GlobeCluster;
};
type RuntimeMapInstance = {
  remove: () => void;
  resize: () => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: Record<string, unknown>) => unknown;
  flyTo: (options: Record<string, unknown>) => unknown;
  getCenter: () => { lat: number; lng: number };
  getContainer: () => HTMLElement;
  getZoom: () => number;
  on: (event: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) => unknown;
  off: (event: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) => unknown;
};
type ThreeGlobeClusterDatum = GlobeCluster & {
  label: string;
};
type ThreeGlobeDebugState = {
  status: "initializing" | "loading-three" | "checking-webgl" | "creating-scene" | "rendering" | "failed";
  error?: string;
  width: number;
  height: number;
  frameCount: number;
  markerCount: number;
  visibleMarkerCount: number;
  webgl: "unknown" | "available" | "unavailable";
  countries: number;
  cities: number;
};

const CONDITION_LABELS: Record<RuntimeSecurityRuleCondition["kind"], string> = {
  method: "Method",
  path_prefix: "Path prefix",
  content_type: "Content-Type",
  body_contains: "Body contains",
  source_ip_class: "Source IP class",
};
const MAP_WINDOWS: Array<{ value: RuntimeMapWindow; label: string; ms: number | null }> = [
  { value: "1m", label: "1m", ms: 60_000 },
  { value: "5m", label: "5m", ms: 5 * 60_000 },
  { value: "15m", label: "15m", ms: 15 * 60_000 },
  { value: "1h", label: "1h", ms: 60 * 60_000 },
  { value: "all", label: "All", ms: null },
];
const GLOBE_CITY_LABELS = [
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Frankfurt", lat: 50.1109, lng: 8.6821 },
  { name: "Tel Aviv", lat: 32.0853, lng: 34.7818 },
  { name: "Petach Tikva", lat: 32.084, lng: 34.8878 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Sao Paulo", lat: -23.5558, lng: -46.6396 },
  { name: "Lagos", lat: 6.5244, lng: 3.3792 },
  { name: "Johannesburg", lat: -26.2041, lng: 28.0473 },
  { name: "Toronto", lat: 43.6532, lng: -79.3832 },
];
const GLOBE_COUNTRY_LABELS = [
  { name: "United States", lat: 39.5, lng: -98.35, kind: "country" },
  { name: "Canada", lat: 57.5, lng: -106.3, kind: "country" },
  { name: "Brazil", lat: -10.8, lng: -52.9, kind: "country" },
  { name: "United Kingdom", lat: 54.2, lng: -2.6, kind: "country" },
  { name: "France", lat: 46.2, lng: 2.2, kind: "country" },
  { name: "Germany", lat: 51.1, lng: 10.4, kind: "country" },
  { name: "Israel", lat: 31.4, lng: 35.0, kind: "country" },
  { name: "India", lat: 22.7, lng: 78.9, kind: "country" },
  { name: "China", lat: 35.9, lng: 104.2, kind: "country" },
  { name: "Japan", lat: 37.5, lng: 137.8, kind: "country" },
  { name: "Australia", lat: -25.3, lng: 133.8, kind: "country" },
  { name: "South Africa", lat: -30.6, lng: 22.9, kind: "country" },
  { name: "Nigeria", lat: 9.1, lng: 8.7, kind: "country" },
  { name: "Russia", lat: 61.5, lng: 105.3, kind: "country" },
];
const GLOBE_LABELS = [
  ...GLOBE_COUNTRY_LABELS,
  ...GLOBE_CITY_LABELS.map((city) => ({ ...city, kind: "city" })),
];

function decisionClass(decision: RuntimeRequestEvent["decision"]) {
  if (decision === "would_block") return "border-red-500/35 bg-red-500/10 text-red-300";
  if (decision === "flagged") return "border-amber-500/35 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
}

function severityClass(severity?: RuntimeSecuritySeverity) {
  if (severity === "critical") return "text-red-300";
  if (severity === "high") return "text-orange-300";
  if (severity === "medium") return "text-amber-300";
  return "text-slate-400";
}

function formatTime(ts?: string | null) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function conditionText(rule: RuntimeSecurityRule) {
  return `${CONDITION_LABELS[rule.condition.kind]} = ${rule.condition.value}`;
}

function eventTimestampMs(event: RuntimeRequestEvent) {
  const ts = new Date(event.ts).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function decisionRank(decision: RuntimeRequestEvent["decision"]) {
  if (decision === "would_block") return 2;
  if (decision === "flagged") return 1;
  return 0;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const PUBLIC_IP_REGIONS = [
  { region: "North America", lat: 39, lon: -98 },
  { region: "Western Europe", lat: 51, lon: 8 },
  { region: "East Asia", lat: 35, lon: 139 },
  { region: "South America", lat: -23, lon: -46 },
  { region: "South Asia", lat: 19, lon: 73 },
  { region: "Oceania", lat: -33, lon: 151 },
  { region: "Middle East", lat: 25, lon: 55 },
  { region: "Africa", lat: -1, lon: 37 },
];

function locationLabel(geo: NonNullable<RuntimeRequestEvent["sourceGeo"]>) {
  return [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Source geo";
}

function approximateRequestLocation(event: RuntimeRequestEvent): Omit<GlobePoint, "event" | "x" | "y"> {
  if (event.sourceGeo) {
    return {
      region: locationLabel(event.sourceGeo),
      lat: event.sourceGeo.lat,
      lon: event.sourceGeo.lon,
      locationQuality: "source_geo",
    };
  }

  const source = event.sourceIp ?? event.destinationService ?? event.id;
  if (event.sourceIpClass === "private" || event.sourceIpClass === "loopback" || event.sourceIpClass === "link_local") {
    return { region: "Private network", lat: 1.3, lon: 103.8, locationQuality: "approximate" };
  }
  if (event.sourceIpClass === "unknown" || !event.sourceIp) {
    return { region: "Unknown source · Petach Tikva", lat: 32.084, lon: 34.8878, locationQuality: "approximate" };
  }

  const hash = hashString(source);
  const base = PUBLIC_IP_REGIONS[hash % PUBLIC_IP_REGIONS.length];
  const latOffset = (((hash >>> 8) % 1600) / 100) - 8;
  const lonOffset = (((hash >>> 16) % 2400) / 100) - 12;
  return {
    region: base.region,
    lat: Math.max(-62, Math.min(72, base.lat + latOffset)),
    lon: Math.max(-175, Math.min(175, base.lon + lonOffset)),
    locationQuality: "approximate",
  };
}

function globePointFromEvent(event: RuntimeRequestEvent): GlobePoint {
  const location = approximateRequestLocation(event);
  return {
    event,
    ...location,
    x: ((location.lon + 180) / 360) * 100,
    y: ((90 - location.lat) / 180) * 100,
  };
}

function clusterGlobePoints(points: GlobePoint[]): GlobeCluster[] {
  const clusters = new Map<string, GlobeCluster>();
  for (const point of points) {
    const key = `${point.region}:${point.lat.toFixed(3)}:${point.lon.toFixed(3)}`;
    const existing = clusters.get(key);
    if (!existing) {
      clusters.set(key, {
        id: key,
        event: point.event,
        events: [point.event],
        x: point.x,
        y: point.y,
        lat: point.lat,
        lon: point.lon,
        region: point.region,
        locationQuality: point.locationQuality,
        count: 1,
        decision: point.event.decision,
      });
      continue;
    }

    existing.events.push(point.event);
    existing.count += 1;
    if (eventTimestampMs(point.event) > eventTimestampMs(existing.event)) {
      existing.event = point.event;
    }
    if (decisionRank(point.event.decision) > decisionRank(existing.decision)) {
      existing.decision = point.event.decision;
    }
  }

  return Array.from(clusters.values()).sort((a, b) => eventTimestampMs(b.event) - eventTimestampMs(a.event));
}

function summarizeEvent(event: RuntimeRequestEvent) {
  return `${event.method ?? "HTTP"} ${event.path ?? "/"} ${event.statusCode ?? ""}`.trim();
}

function filterPointsByWindow(points: GlobePoint[], windowValue: RuntimeMapWindow): GlobePoint[] {
  const windowConfig = MAP_WINDOWS.find((windowOption) => windowOption.value === windowValue);
  if (!windowConfig?.ms) return points;
  const cutoff = Date.now() - windowConfig.ms;
  return points.filter((point) => eventTimestampMs(point.event) >= cutoff);
}

function windowLabel(windowValue: RuntimeMapWindow) {
  return MAP_WINDOWS.find((windowOption) => windowOption.value === windowValue)?.label ?? windowValue;
}

export default function RuntimeSecurityPanel() {
  const [tab, setTab] = useState<RuntimeTab>("requests");
  const [collapsed, setCollapsed] = useState(true);
  const [globeExpanded, setGlobeExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<RuntimeRequestEvent | null>(null);
  const [rules, setRules] = useState<RuntimeSecurityRule[]>([]);
  const [events, setEvents] = useState<RuntimeRequestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    name: "",
    action: "flag" as RuntimeSecurityAction,
    severity: "medium" as RuntimeSecuritySeverity,
    conditionKind: "method" as RuntimeSecurityRuleCondition["kind"],
    conditionValue: "",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rulesRes, eventsRes] = await Promise.all([
        fetch("/api/runtime-security/rules", { cache: "no-store" }),
        fetch("/api/runtime-security/events?limit=1200", { cache: "no-store" }),
      ]);

      if (!rulesRes.ok || !eventsRes.ok) {
        const body = await (rulesRes.ok ? eventsRes : rulesRes).json().catch(() => ({}));
        setError(body.error ?? "Runtime security data unavailable");
        return;
      }

      const rulesBody = await rulesRes.json();
      const eventsBody = await eventsRes.json();
      setRules(rulesBody.rules ?? []);
      setEvents(eventsBody.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime security data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const matchedEvents = useMemo(
    () => events.filter((event) => event.decision !== "allow"),
    [events],
  );
  const ruleById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  const globePoints = useMemo(
    () => events
      .slice()
      .sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a))
      .map(globePointFromEvent),
    [events],
  );

  const toggleRule = async (rule: RuntimeSecurityRule) => {
    setSavingRuleId(rule.id);
    try {
      const res = await fetch(`/api/runtime-security/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setSavingRuleId(null);
    }
  };

  const deleteRule = async (rule: RuntimeSecurityRule) => {
    setSavingRuleId(rule.id);
    try {
      const res = await fetch(`/api/runtime-security/rules/${encodeURIComponent(rule.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setSavingRuleId(null);
    }
  };

  const createRule = async () => {
    const value = newRule.conditionValue.trim();
    const name = newRule.name.trim();
    if (!value || !name) return;

    setSavingRuleId("new");
    try {
      const res = await fetch("/api/runtime-security/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled: true,
          action: newRule.action,
          severity: newRule.severity,
          condition: {
            kind: newRule.conditionKind,
            value,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to create rule");
      setNewRule((prev) => ({ ...prev, name: "", conditionValue: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSavingRuleId(null);
    }
  };

  return (
    <div className="mb-5 border border-slate-800/70 bg-[#050805]">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={cn(
          "flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-900/30",
          !collapsed && "border-b border-slate-800/70",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert size={16} className="text-amber-300" />
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-100">Runtime Security</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600">v0.9 detect-only policy engine</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            {collapsed ? "Show" : "Hide"}
          </span>
          <ChevronDown
            size={14}
            className={cn("text-slate-500 transition-transform", !collapsed && "rotate-180")}
          />
        </div>
      </button>

      {!collapsed && (
        <>
      <div className="border-b border-slate-800/70 px-4 py-3">
        <RuntimeRequestGlobe
          points={globePoints}
          rules={ruleById}
          expanded={globeExpanded}
          onToggleExpanded={() => setGlobeExpanded((value) => !value)}
          onSelectEvent={setSelectedEvent}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/70 px-4 py-2">
        <div className="flex items-center gap-2">
          {(["requests", "alerts", "rules"] as RuntimeTab[]).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={cn(
                "h-7 px-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                tab === item
                  ? "border border-emerald-700 bg-emerald-950/30 text-emerald-300"
                  : "border border-slate-800 bg-black/30 text-slate-500 hover:text-slate-300",
              )}
            >
              {item}
            </button>
          ))}
          <button
            onClick={(event) => {
              event.stopPropagation();
              load();
            }}
            className="flex h-7 items-center gap-1.5 border border-slate-800 bg-black/30 px-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-300"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-[11px] text-red-300">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      <div className="px-4 py-3">
        {tab === "requests" && (
          <RuntimeEventTable events={events} rules={ruleById} emptyLabel="No runtime request events yet" onSelectEvent={setSelectedEvent} />
        )}

        {tab === "alerts" && (
          <RuntimeEventTable events={matchedEvents} rules={ruleById} emptyLabel="No matched runtime alerts" onSelectEvent={setSelectedEvent} />
        )}

        {tab === "rules" && (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <div className="overflow-hidden border border-slate-800/70">
              <div className="grid grid-cols-[64px_1fr_150px_110px_90px] gap-2 border-b border-slate-800/70 px-3 py-2 text-[9px] uppercase tracking-widest text-slate-600">
                <span>State</span>
                <span>Rule</span>
                <span>Condition</span>
                <span>Last Match</span>
                <span className="text-right">Actions</span>
              </div>
              {rules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-[64px_1fr_150px_110px_90px] items-center gap-2 border-b border-slate-900 px-3 py-2 text-[11px] last:border-b-0">
                  <button
                    onClick={() => toggleRule(rule)}
                    disabled={savingRuleId === rule.id}
                    className={cn(
                      "h-6 border px-2 text-[9px] font-bold uppercase tracking-widest",
                      rule.enabled
                        ? "border-emerald-700 bg-emerald-950/30 text-emerald-300"
                        : "border-slate-800 bg-slate-950 text-slate-500",
                    )}
                  >
                    {rule.enabled ? "On" : "Off"}
                  </button>
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-200">{rule.name}</div>
                    <div className={cn("text-[10px] uppercase tracking-widest", severityClass(rule.severity))}>{rule.severity}</div>
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-400">{conditionText(rule)}</div>
                  <div className="font-mono text-[10px] text-slate-500">{formatTime(rule.lastMatchedAt)}</div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => deleteRule(rule)}
                      disabled={savingRuleId === rule.id}
                      className="p-1.5 text-slate-600 transition-colors hover:text-red-300 disabled:opacity-50"
                      title="Delete rule"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <div className="px-3 py-8 text-center text-[11px] uppercase tracking-widest text-slate-600">No rules configured</div>
              )}
            </div>

            <div className="border border-slate-800/70 bg-black/20 p-3">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Plus size={12} />
                New Rule
              </div>
              <div className="grid gap-2">
                <input
                  value={newRule.name}
                  onChange={(event) => setNewRule((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Rule name"
                  className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newRule.action}
                    onChange={(event) => setNewRule((prev) => ({ ...prev, action: event.target.value as RuntimeSecurityAction }))}
                    className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                  >
                    <option value="flag">Flag</option>
                    <option value="would_block">Would-block</option>
                  </select>
                  <select
                    value={newRule.severity}
                    onChange={(event) => setNewRule((prev) => ({ ...prev, severity: event.target.value as RuntimeSecuritySeverity }))}
                    className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <select
                  value={newRule.conditionKind}
                  onChange={(event) => setNewRule((prev) => ({
                    ...prev,
                    conditionKind: event.target.value as RuntimeSecurityRuleCondition["kind"],
                    conditionValue: "",
                  }))}
                  className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                >
                  <option value="method">Method</option>
                  <option value="path_prefix">Path prefix</option>
                  <option value="content_type">Content-Type</option>
                  <option value="body_contains">Body contains</option>
                  <option value="source_ip_class">Source IP class</option>
                </select>
                {newRule.conditionKind === "source_ip_class" ? (
                  <select
                    value={newRule.conditionValue}
                    onChange={(event) => setNewRule((prev) => ({ ...prev, conditionValue: event.target.value }))}
                    className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                  >
                    <option value="">Select source class</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                ) : (
                  <input
                    value={newRule.conditionValue}
                    onChange={(event) => setNewRule((prev) => ({ ...prev, conditionValue: event.target.value }))}
                    placeholder="Condition value"
                    className="h-8 border border-slate-800 bg-[#050805] px-2 text-xs text-slate-200 outline-none focus:border-emerald-800"
                  />
                )}
                <button
                  onClick={createRule}
                  disabled={savingRuleId === "new" || !newRule.name.trim() || !newRule.conditionValue.trim()}
                  className="mt-1 flex h-8 items-center justify-center gap-2 border border-emerald-700 bg-emerald-950/30 text-[10px] font-bold uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-900/35 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
                >
                  <Plus size={12} />
                  Add Rule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {selectedEvent && (
        <RuntimeEventDetailModal
          event={selectedEvent}
          rules={ruleById}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

function RuntimeRequestGlobe({
  points,
  rules,
  expanded,
  onToggleExpanded,
  onSelectEvent,
}: {
  points: GlobePoint[];
  rules: Map<string, RuntimeSecurityRule>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelectEvent: (event: RuntimeRequestEvent) => void;
}) {
  const [mapWindow, setMapWindow] = useState<RuntimeMapWindow>("5m");
  const [selectedCluster, setSelectedCluster] = useState<GlobeCluster | null>(null);
  const visiblePoints = useMemo(() => filterPointsByWindow(points, mapWindow), [mapWindow, points]);
  const suspiciousCount = visiblePoints.filter((point) => point.event.decision !== "allow").length;
  const latest = visiblePoints[0]?.event;
  const clusters = useMemo(() => clusterGlobePoints(visiblePoints), [visiblePoints]);
  const globe = (
    <div className={cn(
      "relative overflow-hidden border border-sky-900/60 bg-[#020713]",
      expanded ? "h-[min(78vh,760px)]" : "h-72",
    )}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(56,189,248,0.18),rgba(14,116,144,0.08)_28%,rgba(0,0,0,0.92)_78%)]" />
      <div className="absolute inset-0 opacity-[0.14] bg-[radial-gradient(circle_at_18%_24%,#ffffff_0_1px,transparent_1.4px),radial-gradient(circle_at_72%_34%,#ffffff_0_1px,transparent_1.3px),radial-gradient(circle_at_42%_72%,#ffffff_0_1px,transparent_1.2px)] bg-[length:130px_90px,170px_120px,210px_150px]" />

      <ThreeRequestGlobe
        clusters={clusters}
        expanded={expanded}
        onSelectCluster={setSelectedCluster}
      />

      {false && (
        <>
        <MapLibreRequestMap
          clusters={clusters}
          expanded={expanded}
          viewKey={mapWindow}
          tileUrls={[]}
          attribution=""
          onSelectCluster={setSelectedCluster}
          onMapInitError={() => undefined}
        />

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="runtime-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="runtime-earth-clip">
            <ellipse cx="500" cy="260" rx="340" ry="220" />
          </clipPath>
          <radialGradient id="runtime-ocean-fill" cx="38%" cy="32%" r="70%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="22%" stopColor="#0ea5e9" />
            <stop offset="56%" stopColor="#075985" />
            <stop offset="82%" stopColor="#082f49" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <radialGradient id="runtime-atmosphere" cx="42%" cy="36%" r="64%">
            <stop offset="0%" stopColor="#e0f2fe" stopOpacity="0.28" />
            <stop offset="48%" stopColor="#38bdf8" stopOpacity="0.1" />
            <stop offset="76%" stopColor="#0284c7" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.72" />
          </radialGradient>
          <linearGradient id="runtime-earth-shadow" x1="25%" y1="20%" x2="90%" y2="80%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="58%" stopColor="#000000" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id="runtime-cloud-fill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.24" />
            <stop offset="50%" stopColor="#f8fafc" stopOpacity="0.46" />
            <stop offset="100%" stopColor="#f8fafc" stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <ellipse cx="500" cy="260" rx="352" ry="232" fill="#38bdf8" opacity="0.08" filter="url(#runtime-glow)" />
        <ellipse cx="500" cy="260" rx="340" ry="220" fill="url(#runtime-ocean-fill)" stroke="#7dd3fc" strokeWidth="1.4" />

        <g clipPath="url(#runtime-earth-clip)">
          <rect x="160" y="40" width="680" height="440" fill="transparent" />

          <path d="M232 152 C252 122 304 101 348 114 C386 125 400 154 380 180 C362 204 328 202 304 223 C280 244 278 283 252 286 C228 289 216 258 225 231 C235 203 211 183 232 152 Z" fill="#2f8f46" />
          <path d="M326 271 C363 259 397 278 414 316 C432 357 415 399 376 434 C354 405 355 368 331 338 C313 315 302 287 326 271 Z" fill="#2f8f46" />
          <path d="M276 174 C309 152 350 149 383 169 C363 183 338 191 315 214 C294 208 277 195 276 174 Z" fill="#9a7b3f" opacity="0.55" />

          <path d="M428 129 C486 94 587 90 661 118 C701 133 744 154 770 187 C723 194 678 186 632 198 C591 209 570 236 524 225 C496 218 489 190 453 181 C427 174 409 150 428 129 Z" fill="#377f3e" />
          <path d="M527 222 C557 206 608 204 651 222 C689 238 727 263 752 301 C709 320 668 309 636 336 C615 354 610 389 581 394 C560 361 551 330 531 303 C512 278 500 239 527 222 Z" fill="#3f8f42" />
          <path d="M589 313 C610 300 644 303 666 326 C651 365 626 395 590 414 C572 383 568 340 589 313 Z" fill="#9a7b3f" opacity="0.52" />
          <path d="M445 138 C493 106 567 101 625 119 C605 140 547 148 509 167 C480 160 456 151 445 138 Z" fill="#c7b061" opacity="0.48" />
          <path d="M629 178 C677 157 739 175 778 216 C734 226 691 215 649 235 C633 217 622 196 629 178 Z" fill="#9a7b3f" opacity="0.5" />

          <path d="M687 344 C731 320 782 335 810 378 C771 412 718 401 687 344 Z" fill="#2f8f46" />
          <path d="M759 398 C779 390 806 398 817 421 C795 432 772 425 759 398 Z" fill="#3f8f42" />

          <path d="M200 78 C252 60 321 62 373 84" fill="none" stroke="#f8fafc" strokeWidth="18" strokeLinecap="round" opacity="0.5" />
          <path d="M408 89 C485 71 579 74 664 100" fill="none" stroke="#f8fafc" strokeWidth="15" strokeLinecap="round" opacity="0.38" />
          <path d="M585 249 C657 230 747 244 812 283" fill="none" stroke="url(#runtime-cloud-fill)" strokeWidth="16" strokeLinecap="round" opacity="0.5" />
          <path d="M224 337 C311 314 410 323 494 365" fill="none" stroke="url(#runtime-cloud-fill)" strokeWidth="14" strokeLinecap="round" opacity="0.36" />
          <path d="M454 414 C538 393 644 403 723 444" fill="none" stroke="#f8fafc" strokeWidth="12" strokeLinecap="round" opacity="0.28" />

          {[230, 310, 390, 470, 550, 630, 710, 790].map((x) => (
            <ellipse key={x} cx="500" cy="260" rx={Math.abs(x - 500) * 0.78} ry="220" fill="none" stroke="#bae6fd" strokeWidth="0.55" opacity="0.12" />
          ))}
          {[115, 165, 215, 260, 305, 355, 405].map((y) => (
            <ellipse key={y} cx="500" cy="260" rx="340" ry={Math.abs(y - 260)} fill="none" stroke="#bae6fd" strokeWidth="0.55" opacity="0.1" />
          ))}

          <ellipse cx="500" cy="260" rx="340" ry="220" fill="url(#runtime-earth-shadow)" />
          <ellipse cx="500" cy="260" rx="340" ry="220" fill="url(#runtime-atmosphere)" opacity="0.58" />
        </g>

        <ellipse cx="500" cy="260" rx="340" ry="220" fill="none" stroke="#bae6fd" strokeWidth="1" opacity="0.68" />
        <path d="M276 92 C350 50 498 42 628 76 C733 103 820 174 842 260" fill="none" stroke="#e0f2fe" strokeWidth="2" opacity="0.28" />
      </svg>

      {clusters.map((cluster, index) => {
        const event = cluster.event;
        const hot = cluster.decision === "would_block";
        const flagged = cluster.decision === "flagged";
        const age = Math.max(0, Date.now() - eventTimestampMs(event));
        const fresh = age < 15_000;
        const size = Math.min(26, (hot ? 16 : flagged ? 13 : 10) + Math.floor(Math.log2(cluster.count) * 3));
        return (
          <button
            key={cluster.id}
            type="button"
            onClick={() => setSelectedCluster(cluster)}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
            title={`${cluster.count} request${cluster.count === 1 ? "" : "s"} from ${cluster.region} · latest ${summarizeEvent(event)}`}
          >
            <span
              className={cn(
                "runtime-map-marker-vibe block border shadow-[0_0_18px_rgba(16,185,129,0.55)]",
                hot ? "border-red-200 bg-red-400" : flagged ? "border-amber-100 bg-amber-300" : "border-emerald-100 bg-emerald-300",
              )}
              style={{
                width: size + 10 - Math.min(index, 8),
                height: size + 10 - Math.min(index, 8),
                animationDelay: `${(index % 6) * 120}ms`,
                borderRadius: "9999px",
              }}
            />
            <span
              className={cn(
                "absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 border",
                hot ? "border-red-100 bg-red-400" : flagged ? "border-amber-100 bg-amber-300" : "border-emerald-100 bg-emerald-300",
              )}
              style={{ width: size, height: size, borderRadius: "9999px" }}
            />
            <span
              className={cn(
                "runtime-map-beacon absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 border",
                hot ? "border-red-300/80" : flagged ? "border-amber-300/75" : "border-emerald-300/70",
              )}
              style={{
                width: size + 24,
                height: size + 24,
                borderRadius: "9999px",
                animationDelay: `${(index % 5) * 140}ms`,
              }}
            />
            {cluster.count > 1 && (
              <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-black">
                {cluster.count > 99 ? "99+" : cluster.count}
              </span>
            )}
          </button>
        );
      })}
      </>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-2 border border-emerald-900/70 bg-black/55 px-3 py-2 backdrop-blur-sm">
        <Globe2 size={14} className="text-emerald-300" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Request Source Globe</div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500">
            {visiblePoints.length} requests · {clusters.length} clusters · {suspiciousCount} matched · 3D earth
          </div>
        </div>
      </div>

      <div className="absolute left-3 top-16 flex items-center gap-1 border border-slate-800/80 bg-black/55 p-1 backdrop-blur-sm">
        {MAP_WINDOWS.map((windowOption) => (
          <button
            key={windowOption.value}
            type="button"
            onClick={() => setMapWindow(windowOption.value)}
            className={cn(
              "h-6 px-2 text-[9px] font-bold uppercase tracking-widest transition-colors",
              mapWindow === windowOption.value
                ? "bg-emerald-400 text-black"
                : "text-slate-500 hover:bg-slate-900/70 hover:text-slate-200",
            )}
          >
            {windowOption.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleExpanded}
        className="absolute right-3 top-3 flex h-8 items-center gap-2 border border-slate-700 bg-black/55 px-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
      >
        {expanded ? <X size={13} /> : <Maximize2 size={13} />}
        {expanded ? "Close" : "Maximize"}
      </button>

      <div className="absolute bottom-3 left-3 right-3 grid gap-2 md:grid-cols-[1fr_260px]">
        <div className="border border-slate-800/80 bg-black/60 px-3 py-2 backdrop-blur-sm">
          <div className="text-[9px] uppercase tracking-widest text-slate-600">Latest Request</div>
          <div className="mt-1 truncate text-xs font-bold text-slate-200">{latest ? summarizeEvent(latest) : "No runtime requests yet"}</div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{latest?.sourceIp ?? "waiting for source IP"} {latest?.destinationService ? `-> ${latest.destinationService}` : ""}</div>
        </div>
        <div className="grid grid-cols-3 border border-slate-800/80 bg-black/60 backdrop-blur-sm">
          <Metric label="allow" value={visiblePoints.filter((point) => point.event.decision === "allow").length} />
          <Metric label="flagged" value={visiblePoints.filter((point) => point.event.decision === "flagged").length} />
          <Metric label="would block" value={visiblePoints.filter((point) => point.event.decision === "would_block").length} />
        </div>
      </div>

      {selectedCluster && (
        <RuntimeClusterRequestsModal
          cluster={selectedCluster}
          windowValue={mapWindow}
          rules={rules}
          onClose={() => setSelectedCluster(null)}
          onSelectEvent={(event) => {
            setSelectedCluster(null);
            onSelectEvent(event);
          }}
        />
      )}
    </div>
  );

  if (!expanded) return globe;

  return (
    <div className="fixed inset-4 z-[120] bg-black/80 p-3 backdrop-blur-md">
      {globe}
      <div className="mt-3 max-h-40 overflow-y-auto border border-slate-800 bg-black/75">
        {visiblePoints.slice(0, 12).map((point) => {
          const rule = point.event.matchedRuleIds[0] ? rules.get(point.event.matchedRuleIds[0]) : null;
          return (
            <button
              key={`expanded-${point.event.id}`}
              type="button"
              onClick={() => onSelectEvent(point.event)}
              className="grid w-full grid-cols-[80px_120px_1fr_130px] items-center gap-2 border-b border-slate-900 px-3 py-2 text-left text-[11px] last:border-b-0 hover:bg-slate-900/45"
            >
              <span className="font-mono text-slate-500">{formatTime(point.event.ts)}</span>
              <span className="truncate font-mono text-slate-400">{point.event.sourceIp ?? point.region}</span>
              <span className="truncate font-mono text-slate-200">{summarizeEvent(point.event)}</span>
              <span className="truncate text-slate-500">{rule?.name ?? point.event.decision}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function drawRuntimeEarthTexture(canvas: HTMLCanvasElement) {
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const land = "rgba(63, 132, 82, 0.96)";
  const desert = "rgba(174, 151, 91, 0.82)";
  const ice = "rgba(226, 232, 240, 0.92)";
  const line = "rgba(186, 230, 253, 0.1)";
  const x = (lon: number) => ((lon + 180) / 360) * canvas.width;
  const y = (lat: number) => ((90 - lat) / 180) * canvas.height;
  const blob = (points: Array<[number, number]>, fill: string) => {
    ctx.beginPath();
    points.forEach(([lon, lat], index) => {
      const px = x(lon);
      const py = y(lat);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.fillStyle = "#0b4f6f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  blob([[-168, 72], [-132, 72], [-105, 56], [-82, 50], [-60, 48], [-54, 26], [-82, 8], [-105, 18], [-124, 32], [-150, 48]], land);
  blob([[-82, 12], [-52, 6], [-35, -18], [-48, -54], [-67, -55], [-80, -22]], land);
  blob([[-18, 36], [15, 37], [36, 31], [50, 12], [42, -34], [20, -35], [7, 5], [-10, 12]], land);
  blob([[-10, 35], [28, 60], [72, 56], [104, 45], [138, 50], [160, 34], [146, 6], [108, 1], [80, 18], [42, 24], [18, 35]], land);
  blob([[72, 8], [92, 22], [106, 6], [96, -10], [78, -4]], land);
  blob([[112, -10], [154, -12], [154, -44], [116, -39]], land);
  blob([[-18, 32], [40, 28], [56, 16], [34, 6], [2, 14]], desert);
  blob([[36, 28], [72, 36], [86, 24], [58, 14]], desert);
  blob([[-180, 90], [180, 90], [180, 74], [-180, 74]], ice);
  blob([[-180, -70], [180, -70], [180, -90], [-180, -90]], ice);

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let lon = -150; lon <= 180; lon += 30) {
    ctx.beginPath();
    ctx.moveTo(x(lon), y(75));
    ctx.lineTo(x(lon), y(-75));
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    ctx.moveTo(x(-180), y(lat));
    ctx.lineTo(x(180), y(lat));
    ctx.stroke();
  }

  const cloud = "rgba(248, 250, 252, 0.22)";
  ctx.strokeStyle = cloud;
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  [
    [[-160, 50], [-116, 54], [-76, 48]],
    [[-20, 58], [34, 63], [92, 54]],
    [[72, 4], [118, 7], [160, -2]],
    [[-94, -28], [-42, -34], [2, -24]],
  ].forEach((path) => {
    ctx.beginPath();
    path.forEach(([lon, lat], index) => {
      if (index === 0) ctx.moveTo(x(lon), y(lat));
      else ctx.lineTo(x(lon), y(lat));
    });
    ctx.stroke();
  });
}

function latLonToVector3(lat: number, lon: number, radius: number, THREE: any) {
  const phi = degreesToRadians(90 - lat);
  const theta = degreesToRadians(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function ThreeRequestGlobe({
  clusters,
  expanded,
  onSelectCluster,
}: {
  clusters: GlobeCluster[];
  expanded: boolean;
  onSelectCluster: (cluster: GlobeCluster) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clustersRef = useRef<GlobeCluster[]>(clusters);
  const globeRef = useRef<any>(null);
  const lastServerDebugRef = useRef<string>("");
  const showClientDebug = process.env.NEXT_PUBLIC_WATCHMEN_DEBUG === "true";
  const [debug, setDebug] = useState<ThreeGlobeDebugState>({
    status: "initializing",
    width: 0,
    height: 0,
    frameCount: 0,
    markerCount: clusters.length,
    visibleMarkerCount: 0,
    webgl: "unknown",
    countries: 0,
    cities: GLOBE_CITY_LABELS.length,
  });

  useEffect(() => {
    clustersRef.current = clusters;
    const globe = globeRef.current;
    if (globe) {
      const clusterData: ThreeGlobeClusterDatum[] = clusters.map((cluster) => ({
        ...cluster,
        label: cluster.count > 99 ? "99+" : String(cluster.count),
      }));
      globe.pointsData(clusterData);
      globe.htmlElementsData(clusterData);
      globe.labelsData(GLOBE_LABELS);
    }
    setDebug((prev) => ({ ...prev, markerCount: clusters.length }));
  }, [clusters]);

  useEffect(() => {
    const shouldReport = debug.status === "failed"
      || debug.frameCount <= 3
      || debug.frameCount % 120 === 0;
    const key = `${debug.status}:${debug.webgl}:${debug.width}:${debug.height}:${debug.frameCount}:${debug.markerCount}:${debug.visibleMarkerCount}:${debug.countries}:${debug.cities}:${debug.error ?? ""}`;
    if (!shouldReport || lastServerDebugRef.current === key) return;
    lastServerDebugRef.current = key;

    fetch("/api/runtime-security/globe-debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(debug),
      keepalive: true,
    }).catch((error) => {
      console.warn("[runtime-security] failed to report globe debug", error);
    });
  }, [debug]);

  useEffect(() => {
    let disposed = false;
    let animationId = 0;
    let renderer: any;
    let labelRenderer: any;
    let controls: any;
    let resizeObserver: ResizeObserver | null = null;

    async function start() {
      const container = containerRef.current;
      if (!container) {
        setDebug((prev) => ({ ...prev, status: "failed", error: "Three globe container ref was not mounted" }));
        return;
      }

      try {
        setDebug((prev) => ({
          ...prev,
          status: "loading-three",
          width: container.clientWidth || 0,
          height: container.clientHeight || 0,
        }));
        const THREE = await import("three");
        const [{ OrbitControls }, { CSS2DRenderer }, threeGlobeModule, topojson, countriesTopology] = await Promise.all([
          import("three/examples/jsm/controls/OrbitControls.js"),
          import("three/examples/jsm/renderers/CSS2DRenderer.js"),
          import("three-globe"),
          import("topojson-client"),
          import("world-atlas/countries-110m.json"),
        ]);
        if (disposed || !containerRef.current) return;

        setDebug((prev) => ({ ...prev, status: "checking-webgl" }));
        const probe = document.createElement("canvas");
        const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
        if (!gl) {
          setDebug((prev) => ({
            ...prev,
            status: "failed",
            webgl: "unavailable",
            error: "WebGL is unavailable in this browser context",
          }));
          return;
        }
        setDebug((prev) => ({ ...prev, status: "creating-scene", webgl: "available" }));

        const countries = (topojson.feature(
          countriesTopology.default as any,
          (countriesTopology.default as any).objects.countries,
        ) as any).features ?? [];

        const clusterData: ThreeGlobeClusterDatum[] = clustersRef.current.map((cluster) => ({
          ...cluster,
          label: cluster.count > 99 ? "99+" : String(cluster.count),
        }));
        const clusterColor = (cluster: ThreeGlobeClusterDatum) => {
          if (cluster.decision === "would_block") return "rgba(248,113,113,0.95)";
          if (cluster.decision === "flagged") return "rgba(251,191,36,0.95)";
          return "rgba(52,211,153,0.95)";
        };
        const clusterElement = (cluster: ThreeGlobeClusterDatum) => {
          const hot = cluster.decision === "would_block";
          const flagged = cluster.decision === "flagged";
          const size = Math.min(34, (hot ? 18 : flagged ? 15 : 12) + Math.floor(Math.log2(cluster.count) * 4));
          const element = document.createElement("button");
          element.type = "button";
          element.className = "runtime-map-marker-vibe";
          element.textContent = cluster.count > 1 ? cluster.label : "";
          element.style.width = `${size}px`;
          element.style.height = `${size}px`;
          element.style.borderRadius = "9999px";
          element.style.border = hot ? "1px solid #fecaca" : flagged ? "1px solid #fde68a" : "1px solid #bbf7d0";
          element.style.background = hot ? "#f87171" : flagged ? "#fbbf24" : "#34d399";
          element.style.boxShadow = hot
            ? "0 0 0 5px rgba(248,113,113,0.16), 0 0 28px rgba(248,113,113,0.72)"
            : flagged
              ? "0 0 0 5px rgba(251,191,36,0.16), 0 0 24px rgba(251,191,36,0.62)"
              : "0 0 0 5px rgba(52,211,153,0.14), 0 0 20px rgba(52,211,153,0.55)";
          element.style.color = "#020617";
          element.style.cursor = "pointer";
          element.style.display = "flex";
          element.style.alignItems = "center";
          element.style.justifyContent = "center";
          element.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
          element.style.fontSize = cluster.count > 99 ? "9px" : "10px";
          element.style.fontWeight = "800";
          element.style.pointerEvents = "auto";
          element.style.transition = "opacity 180ms ease, transform 180ms ease";
          element.setAttribute("aria-label", `${cluster.count} requests from ${cluster.region}`);
          element.title = `${cluster.count} requests from ${cluster.region}`;
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            onSelectCluster(cluster);
          });
          element.addEventListener("mouseenter", () => {
            element.style.transform = "scale(1.14)";
          });
          element.addEventListener("mouseleave", () => {
            element.style.transform = "scale(1)";
          });
          return element;
        };
        const ThreeGlobe = (threeGlobeModule as any).default ?? threeGlobeModule;
        const globe = new ThreeGlobe()
          .showAtmosphere(true)
          .atmosphereColor("#7dd3fc")
          .atmosphereAltitude(0.16)
          .globeMaterial(new THREE.MeshPhongMaterial({
            color: 0x0b4f6f,
            emissive: 0x062536,
            emissiveIntensity: 0.28,
            shininess: 8,
          }))
          .polygonsData(countries)
          .polygonCapColor(() => "rgba(43, 119, 77, 0.82)")
          .polygonSideColor(() => "rgba(18, 83, 105, 0.55)")
          .polygonStrokeColor(() => "rgba(186, 230, 253, 0.38)")
          .polygonAltitude(0.006)
          .pointsData(clusterData)
          .pointLat((cluster: any) => cluster.lat)
          .pointLng((cluster: any) => cluster.lon)
          .pointAltitude(0.026)
          .pointRadius((cluster: any) => Math.min(1.8, 0.65 + Math.log2(Math.max(1, cluster.count)) * 0.18))
          .pointColor(clusterColor)
          .pointsMerge(false)
          .htmlElementsData(clusterData)
          .htmlLat((cluster: any) => cluster.lat)
          .htmlLng((cluster: any) => cluster.lon)
          .htmlAltitude(0.055)
          .htmlElement(clusterElement)
          .htmlElementVisibilityModifier((element: HTMLElement, isVisible: boolean) => {
            element.style.opacity = isVisible ? "1" : "0";
            element.style.pointerEvents = isVisible ? "auto" : "none";
          })
          .labelsData(GLOBE_LABELS)
          .labelLat((city: any) => city.lat)
          .labelLng((city: any) => city.lng)
          .labelText((city: any) => city.name)
          .labelColor((item: any) => item.kind === "country" ? "rgba(186, 230, 253, 0.78)" : "rgba(226, 232, 240, 0.84)")
          .labelSize((item: any) => item.kind === "country" ? 0.52 : 0.34)
          .labelDotRadius((item: any) => item.kind === "country" ? 0 : 0.08)
          .labelAltitude((item: any) => item.kind === "country" ? 0.014 : 0.02)
          .labelResolution(2);
        globeRef.current = globe;

        setDebug((prev) => ({
          ...prev,
          countries: countries.length,
          cities: GLOBE_CITY_LABELS.length,
        }));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
        camera.position.set(0, 0, expanded ? 430 : 470);

        scene.add(globe);

        const light = new THREE.DirectionalLight(0xffffff, 1.45);
        light.position.set(-180, 140, 260);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0x7dd3fc, 0.82));

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        container.appendChild(renderer.domElement);

        labelRenderer = new CSS2DRenderer();
        labelRenderer.domElement.style.position = "absolute";
        labelRenderer.domElement.style.inset = "0";
        labelRenderer.domElement.style.pointerEvents = "none";
        container.appendChild(labelRenderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.rotateSpeed = 0.55;
        controls.zoomSpeed = 0.75;
        controls.minDistance = 128;
        controls.maxDistance = 620;
        controls.target.set(0, 0, 0);

      const setSize = () => {
          const width = container.clientWidth || 1;
          const height = container.clientHeight || 1;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          labelRenderer.setSize(width, height);
          setDebug((prev) => ({ ...prev, width, height }));
        };
        setSize();
        resizeObserver = new ResizeObserver(setSize);
        resizeObserver.observe(container);

        let frameCount = 0;
        const render = () => {
          if (disposed || !containerRef.current) return;
          controls.update();
          globe.setPointOfView(camera);
          renderer.render(scene, camera);
          labelRenderer.render(scene, camera);

          const width = container.clientWidth || 1;
          const height = container.clientHeight || 1;
          frameCount += 1;
          if (frameCount <= 3 || frameCount % 30 === 0) {
            setDebug((prev) => ({
              ...prev,
              status: "rendering",
              frameCount,
              markerCount: clustersRef.current.length,
              visibleMarkerCount: clustersRef.current.length,
              width,
              height,
            }));
          }
          animationId = window.requestAnimationFrame(render);
        };
        render();
      } catch (error) {
        console.error("[runtime-security] Three globe failed", error);
        setDebug((prev) => ({
          ...prev,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    start();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationId);
      resizeObserver?.disconnect();
      controls?.dispose?.();
      renderer?.dispose?.();
      renderer?.domElement?.remove?.();
      labelRenderer?.domElement?.remove?.();
    };
  }, [expanded]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-x-0 top-0 cursor-grab active:cursor-grabbing",
          expanded ? "bottom-24" : "bottom-20",
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-20 bg-[radial-gradient(circle_at_50%_48%,transparent_0,transparent_42%,rgba(2,6,23,0.1)_58%,rgba(2,6,23,0.66)_100%)]" />
      {(showClientDebug || debug.status === "failed") && (
      <div className={cn(
        "pointer-events-none absolute right-3 top-14 z-20 max-w-[360px] border px-3 py-2 font-mono text-[10px] backdrop-blur-sm",
        debug.status === "failed"
          ? "border-red-500/60 bg-red-950/45 text-red-200"
          : "border-sky-800/70 bg-black/55 text-sky-200",
      )}>
        <div className="mb-1 font-bold uppercase tracking-widest">3D Globe Debug</div>
        <div>status: {debug.status}</div>
        <div>webgl: {debug.webgl}</div>
        <div>canvas: {debug.width}x{debug.height}</div>
        <div>frames: {debug.frameCount}</div>
        <div>countries: {debug.countries}</div>
        <div>cities: {debug.cities}</div>
        <div>clusters: {debug.markerCount} / visible {debug.visibleMarkerCount}</div>
        {debug.error && <div className="mt-1 whitespace-pre-wrap text-red-200">error: {debug.error}</div>}
      </div>
      )}
    </div>
  );
}

function MapLibreRequestMap({
  clusters,
  expanded,
  viewKey,
  tileUrls,
  attribution,
  onSelectCluster,
  onMapInitError,
}: {
  clusters: GlobeCluster[];
  expanded: boolean;
  viewKey: string;
  tileUrls: string[];
  attribution: string;
  onSelectCluster: (cluster: GlobeCluster) => void;
  onMapInitError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<RuntimeMapInstance | null>(null);
  const maplibreRef = useRef<any>(null);
  const markersRef = useRef<RuntimeMapMarker[]>([]);
  const clustersRef = useRef<GlobeCluster[]>(clusters);
  const [readyTick, setReadyTick] = useState(0);
  const [tileError, setTileError] = useState<string | null>(null);

  useEffect(() => {
    clustersRef.current = clusters;
  }, [clusters]);

  useEffect(() => {
    let cancelled = false;

    async function startMap() {
      if (!containerRef.current || mapRef.current) return;

      try {
        const maplibreModule = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;

        const maplibregl = maplibreModule;
        maplibreRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            projection: { type: "globe" },
            sources: {
              "osm-raster": {
                type: "raster",
                tiles: tileUrls,
                tileSize: 256,
                attribution,
              },
            },
            layers: [
              {
                id: "osm-raster",
                type: "raster",
                source: "osm-raster",
                paint: {
                  "raster-saturation": -0.45,
                  "raster-contrast": 0.22,
                  "raster-brightness-min": 0.08,
                  "raster-brightness-max": 0.78,
                },
              },
            ],
          },
          center: [18, 18],
          zoom: 0.8,
          minZoom: 0,
          maxZoom: 8,
          renderWorldCopies: false,
          attributionControl: { compact: true },
          interactive: true,
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "bottom-right");
        if (typeof maplibregl.GlobeControl === "function") {
          map.addControl(new maplibregl.GlobeControl(), "bottom-right");
        }

        map.on("load", () => {
          if (cancelled) return;
          setReadyTick((value) => value + 1);
        });
        map.on("error", (event: { error?: { message?: string } }) => {
          const message = event.error?.message ?? "";
          if (/failed to fetch|could not load|network/i.test(message)) {
            setTileError(message || "Tile provider unreachable");
          }
        });

        mapRef.current = map as unknown as RuntimeMapInstance;
      } catch (error) {
        console.warn("[runtime-security] MapLibre globe failed, using SVG fallback", {
          error: error instanceof Error ? error.message : String(error),
        });
        onMapInitError();
      }
    }

    startMap();

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, [attribution, onMapInitError, tileUrls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = window.setTimeout(() => {
      map.resize();
      fitRuntimeMapToPoints(map, clustersRef.current, expanded);
    }, 80);
    return () => window.clearTimeout(id);
  }, [expanded, readyTick, viewKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || readyTick === 0) return;

    const updateVisibility = () => updateRuntimeMarkerVisibility(map, markersRef.current);
    map.on("move", updateVisibility);
    map.on("zoom", updateVisibility);
    map.on("resize", updateVisibility);
    updateVisibility();

    return () => {
      map.off("move", updateVisibility);
      map.off("zoom", updateVisibility);
      map.off("resize", updateVisibility);
    };
  }, [readyTick]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || readyTick === 0) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = clusters.map((cluster) => {
      const element = document.createElement("button");
      const hot = cluster.decision === "would_block";
      const flagged = cluster.decision === "flagged";
      const size = Math.min(34, (hot ? 18 : flagged ? 15 : 12) + Math.floor(Math.log2(cluster.count) * 4));
      element.type = "button";
      element.style.width = `${size + 34}px`;
      element.style.height = `${size + 34}px`;
      element.style.border = "0";
      element.style.background = "transparent";
      element.style.outline = "0";
      element.style.cursor = "pointer";
      element.style.padding = "0";
      element.style.position = "relative";
      element.style.display = "flex";
      element.style.alignItems = "center";
      element.style.justifyContent = "center";
      element.style.transition = "opacity 120ms linear, visibility 120ms linear";
      element.setAttribute(
        "aria-label",
        `${cluster.count} request${cluster.count === 1 ? "" : "s"} from ${cluster.region}, latest ${summarizeEvent(cluster.event)}`,
      );
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectCluster(cluster);
      });

      const visual = document.createElement("span");
      visual.style.position = "absolute";
      visual.style.inset = "0";
      visual.style.display = "flex";
      visual.style.alignItems = "center";
      visual.style.justifyContent = "center";
      visual.style.transition = "opacity 90ms linear, transform 90ms linear";
      visual.style.willChange = "opacity, transform";
      element.appendChild(visual);

      const dot = document.createElement("span");
      dot.className = "runtime-map-marker-vibe";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "9999px";
      dot.style.border = hot ? "1px solid #fecaca" : flagged ? "1px solid #fde68a" : "1px solid #bbf7d0";
      dot.style.background = hot ? "#f87171" : flagged ? "#fbbf24" : "#34d399";
      dot.style.boxShadow = hot
        ? "0 0 0 5px rgba(248,113,113,0.16), 0 0 28px rgba(248,113,113,0.72)"
        : flagged
          ? "0 0 0 5px rgba(251,191,36,0.16), 0 0 24px rgba(251,191,36,0.62)"
          : "0 0 0 5px rgba(52,211,153,0.14), 0 0 20px rgba(52,211,153,0.55)";
      dot.style.display = "flex";
      dot.style.alignItems = "center";
      dot.style.justifyContent = "center";
      dot.style.color = "#020617";
      dot.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      dot.style.fontSize = cluster.count > 99 ? "9px" : "10px";
      dot.style.fontWeight = "800";
      dot.style.animationDelay = `${(cluster.id.length % 7) * 110}ms`;
      dot.textContent = cluster.count > 1 ? (cluster.count > 99 ? "99+" : String(cluster.count)) : "";
      visual.appendChild(dot);

      const pulse = document.createElement("span");
      pulse.style.position = "absolute";
      pulse.style.left = "50%";
      pulse.style.top = "50%";
      pulse.style.width = `${size + 16}px`;
      pulse.style.height = `${size + 16}px`;
      pulse.style.marginLeft = `${-(size + 16) / 2}px`;
      pulse.style.marginTop = `${-(size + 16) / 2}px`;
      pulse.style.borderRadius = "9999px";
      pulse.style.border = `1px solid ${hot ? "rgba(248,113,113,0.45)" : flagged ? "rgba(251,191,36,0.45)" : "rgba(52,211,153,0.4)"}`;
      pulse.style.opacity = "0.7";
      pulse.style.animation = "runtime-map-pulse 1.8s ease-out infinite";
      visual.appendChild(pulse);

      const beacon = document.createElement("span");
      beacon.className = "runtime-map-beacon";
      beacon.style.position = "absolute";
      beacon.style.left = "50%";
      beacon.style.top = "50%";
      beacon.style.width = `${size + 28}px`;
      beacon.style.height = `${size + 28}px`;
      beacon.style.marginLeft = `${-(size + 28) / 2}px`;
      beacon.style.marginTop = `${-(size + 28) / 2}px`;
      beacon.style.borderRadius = "9999px";
      beacon.style.border = `1px solid ${hot ? "rgba(252,165,165,0.8)" : flagged ? "rgba(252,211,77,0.75)" : "rgba(110,231,183,0.7)"}`;
      beacon.style.animationDelay = `${(cluster.id.length % 5) * 140}ms`;
      visual.appendChild(beacon);

      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
        opacity: "1",
        opacityWhenCovered: "0.02",
        subpixelPositioning: true,
      })
        .setLngLat([cluster.lon, cluster.lat])
        .addTo(map);

      return {
        remove: () => marker.remove(),
        element,
        visual,
        cluster,
      };
    });
    updateRuntimeMarkerVisibility(map, markersRef.current);

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [clusters, onSelectCluster, readyTick]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_0,transparent_42%,rgba(0,0,0,0.42)_72%,rgba(0,0,0,0.72)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
      {tileError && (
        <div className="pointer-events-none absolute right-3 top-14 max-w-[320px] border border-amber-700/70 bg-black/70 px-3 py-2 text-[10px] uppercase tracking-widest text-amber-300 backdrop-blur-sm">
          Tile provider unreachable
        </div>
      )}
    </div>
  );
}

function fitRuntimeMapToPoints(map: RuntimeMapInstance, points: Array<{ lat: number; lon: number }>, expanded: boolean) {
  if (points.length === 0) {
    map.flyTo({
      center: [18, 18],
      zoom: expanded ? 1.35 : 0.8,
      duration: 650,
      essential: true,
    });
    return;
  }

  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  const west = Math.max(-178, Math.min(...lons) - 24);
  const east = Math.min(178, Math.max(...lons) + 24);
  const south = Math.max(-70, Math.min(...lats) - 14);
  const north = Math.min(78, Math.max(...lats) + 14);
  map.fitBounds([[west, south], [east, north]], {
    padding: expanded ? 120 : 56,
    duration: 650,
    maxZoom: expanded ? 2.6 : 1.45,
    essential: true,
  });
}

function degreesToRadians(value: number) {
  return value * (Math.PI / 180);
}

function angularDistanceDegrees(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return (2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))) * (180 / Math.PI);
}

function updateRuntimeMarkerVisibility(map: RuntimeMapInstance, markers: RuntimeMapMarker[]) {
  const center = map.getCenter();
  const zoom = map.getZoom();

  for (const marker of markers) {
    const distance = angularDistanceDegrees(
      { lat: center.lat, lon: center.lng },
      { lat: marker.cluster.lat, lon: marker.cluster.lon },
    );
    const opacity = distance <= 58
      ? 1
      : distance <= 66
        ? Math.max(0.08, 1 - ((distance - 58) / 8) * 0.92)
        : 0;
    const scale = zoom < 0.8 ? 0.52 : zoom < 1.15 ? 0.68 : zoom < 1.65 ? 0.84 : 1;
    const visible = opacity > 0.01;

    marker.element.style.display = "flex";
    marker.element.style.opacity = String(opacity);
    marker.visual.style.opacity = String(opacity);
    marker.visual.style.transform = `scale(${scale})`;
    marker.element.style.pointerEvents = opacity > 0.12 ? "auto" : "none";
    marker.element.style.visibility = visible ? "visible" : "hidden";
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-slate-800 px-3 py-2 last:border-r-0">
      <div className="font-mono text-lg font-bold text-slate-100">{value}</div>
      <div className="text-[8px] uppercase tracking-widest text-slate-600">{label}</div>
    </div>
  );
}

function RuntimeEventDetailModal({
  event,
  rules,
  onClose,
}: {
  event: RuntimeRequestEvent;
  rules: Map<string, RuntimeSecurityRule>;
  onClose: () => void;
}) {
  const matchedRules = event.matchedRuleIds.map((id) => rules.get(id)).filter((rule): rule is RuntimeSecurityRule => Boolean(rule));
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col border border-slate-700 bg-[#050805] shadow-2xl shadow-black">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <ShieldAlert size={16} className={event.decision === "allow" ? "text-emerald-300" : "text-amber-300"} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold uppercase tracking-widest text-slate-100">{summarizeEvent(event)}</div>
            <div className="truncate font-mono text-[10px] text-slate-500">
              {event.sourceIp ?? "unknown source"} {"->"} {event.destinationService ?? event.destinationWorkload ?? "unknown destination"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 text-slate-500 transition-colors hover:text-slate-200"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 lg:grid-cols-[240px_1fr]">
          <div className="space-y-3">
            <div className={cn("w-fit border px-2 py-1 text-[10px] font-bold uppercase tracking-widest", decisionClass(event.decision))}>
              {event.decision.replace("_", " ")}
            </div>
            <Detail label="Time" value={event.ts} />
            <Detail label="Source IP" value={event.sourceIp ?? "-"} />
            <Detail label="Source class" value={event.sourceIpClass ?? "-"} />
            <Detail label="Content-Type" value={event.contentType ?? "-"} />
            <Detail label="Body size" value={event.bodySize === undefined ? "-" : `${event.bodySize} bytes`} />
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">Matched Rules</div>
              {matchedRules.length > 0 ? (
                <div className="grid gap-2">
                  {matchedRules.map((rule) => (
                    <div key={rule.id} className="border border-slate-800 bg-black/30 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-bold text-slate-200">{rule.name}</span>
                        <span className={cn("text-[9px] uppercase tracking-widest", severityClass(rule.severity))}>{rule.severity}</span>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-slate-500">{conditionText(rule)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-slate-800 bg-black/30 px-3 py-3 text-[11px] uppercase tracking-widest text-slate-600">No rules matched</div>
              )}
            </div>

            <div>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">Request Content</div>
              <pre className="max-h-72 overflow-auto border border-slate-800 bg-black/60 p-3 text-[11px] leading-relaxed text-emerald-300">
                {JSON.stringify(event, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{label}</div>
      <div className="mt-1 break-words font-mono text-[11px] text-slate-300">{value}</div>
    </div>
  );
}

function RuntimeClusterRequestsModal({
  cluster,
  windowValue,
  rules,
  onClose,
  onSelectEvent,
}: {
  cluster: GlobeCluster;
  windowValue: RuntimeMapWindow;
  rules: Map<string, RuntimeSecurityRule>;
  onClose: () => void;
  onSelectEvent: (event: RuntimeRequestEvent) => void;
}) {
  const sortedEvents = [...cluster.events].sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a));
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col border border-slate-700 bg-[#050805] shadow-2xl shadow-black">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Globe2 size={16} className={cluster.decision === "allow" ? "text-emerald-300" : "text-amber-300"} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold uppercase tracking-widest text-slate-100">
              {cluster.count} request{cluster.count === 1 ? "" : "s"} · {cluster.region}
            </div>
            <div className="truncate font-mono text-[10px] text-slate-500">
              {windowLabel(windowValue)} window · {cluster.locationQuality === "source_geo" ? "source coordinates" : "approximate location"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 text-slate-500 transition-colors hover:text-slate-200"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="overflow-hidden border border-slate-800/70">
            <div className="grid grid-cols-[82px_120px_76px_minmax(180px,1fr)_118px_160px] gap-2 border-b border-slate-800/70 px-3 py-2 text-[9px] uppercase tracking-widest text-slate-600">
              <span>Time</span>
              <span>Source</span>
              <span>Method</span>
              <span>Path</span>
              <span>Decision</span>
              <span>Matched Rule</span>
            </div>
            {sortedEvents.map((event) => {
              const firstRule = event.matchedRuleIds[0] ? rules.get(event.matchedRuleIds[0]) : null;
              return (
                <button
                  key={`cluster-${cluster.id}-${event.id}`}
                  type="button"
                  onClick={() => onSelectEvent(event)}
                  className="grid w-full grid-cols-[82px_120px_76px_minmax(180px,1fr)_118px_160px] items-center gap-2 border-b border-slate-900 px-3 py-2 text-left text-[11px] transition-colors last:border-b-0 hover:bg-slate-900/45"
                >
                  <span className="font-mono text-slate-500">{formatTime(event.ts)}</span>
                  <span className="truncate font-mono text-slate-400">{event.sourceIp ?? "-"}</span>
                  <span className="font-mono font-bold text-emerald-300">{event.method ?? "HTTP"}</span>
                  <span className="truncate font-mono text-slate-300">{event.path ?? "/"}</span>
                  <span className={cn("w-fit border px-2 py-1 text-[9px] font-bold uppercase tracking-widest", decisionClass(event.decision))}>
                    {event.decision.replace("_", " ")}
                  </span>
                  <span className="truncate text-slate-400">{firstRule?.name ?? event.matchedRuleIds[0] ?? "-"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function RuntimeEventTable({
  events,
  rules,
  emptyLabel,
  onSelectEvent,
}: {
  events: RuntimeRequestEvent[];
  rules: Map<string, RuntimeSecurityRule>;
  emptyLabel: string;
  onSelectEvent: (event: RuntimeRequestEvent) => void;
}) {
  return (
    <div className="overflow-hidden border border-slate-800/70">
      <div className="grid grid-cols-[82px_110px_76px_minmax(160px,1fr)_110px_118px_160px] gap-2 border-b border-slate-800/70 px-3 py-2 text-[9px] uppercase tracking-widest text-slate-600">
        <span>Time</span>
        <span>Source</span>
        <span>Method</span>
        <span>Path</span>
        <span>Status</span>
        <span>Decision</span>
        <span>Matched Rule</span>
      </div>
      {events.map((event) => {
        const firstRule = event.matchedRuleIds[0] ? rules.get(event.matchedRuleIds[0]) : null;
        return (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent(event)}
            className="grid w-full grid-cols-[82px_110px_76px_minmax(160px,1fr)_110px_118px_160px] items-center gap-2 border-b border-slate-900 px-3 py-2 text-left text-[11px] transition-colors last:border-b-0 hover:bg-slate-900/45"
          >
            <span className="font-mono text-slate-500">{formatTime(event.ts)}</span>
            <span className="truncate font-mono text-slate-400">{event.sourceIp ?? "-"}</span>
            <span className={cn("font-mono font-bold", event.method === "DELETE" ? "text-red-300" : "text-emerald-300")}>{event.method ?? "-"}</span>
            <span className="truncate font-mono text-slate-300">{event.path ?? "/"}</span>
            <span className="font-mono text-slate-400">{event.statusCode ?? "-"}</span>
            <span className={cn("inline-flex h-6 w-fit items-center gap-1.5 border px-2 text-[9px] font-bold uppercase tracking-widest", decisionClass(event.decision))}>
              {event.decision === "allow" ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
              {event.decision.replace("_", " ")}
            </span>
            <span className="truncate text-slate-400">{firstRule?.name ?? event.matchedRuleIds[0] ?? "-"}</span>
          </button>
        );
      })}
      {events.length === 0 && (
        <div className="px-3 py-8 text-center text-[11px] uppercase tracking-widest text-slate-600">{emptyLabel}</div>
      )}
    </div>
  );
}
