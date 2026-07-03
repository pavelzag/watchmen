"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QueryBox, { type QueryResult } from "@/components/QueryBox";
import ResultCard from "@/components/ResultCard";
import SnapshotStats from "@/components/SnapshotStats";
import { Check, ChevronDown, ChevronUp, Cloud, KeyRound, ShieldCheck } from "lucide-react";
import { saveSnapshot } from "@/lib/snapshot-history";
import type { GcpSnapshot } from "@/lib/gcp/types";
import { getDemoCredentials, getDemoGcpSnapshot, setDemoGcpSnapshot } from "@/lib/demo-credentials";
import { useTaskCenter } from "@/components/TaskCenterProvider";
import AwsDashboardClient from "./aws/AwsDashboardClient";
import DemoAiNotice from "@/components/DemoAiNotice";

const GCP_SUGGESTED_QUERIES = [
  "Which Cloud Storage buckets are publicly accessible?",
  "List all expired service account keys",
  "Which VMs have external IPs?",
  "Who has owner or editor access?",
  "What secrets does allUsers have access to?",
  "Show all firewall rules open to the internet",
];

type CloudConnections = { gcp: boolean; aws: boolean };
type DashboardView = "gcp" | "aws";

function CloudConnectionCards({ connections }: { connections: CloudConnections }) {
  return (
    <section className="grid gap-3 md:grid-cols-2">
      <div className="border p-4 space-y-3" style={{ borderColor: "rgba(59, 130, 246, 0.28)", background: "rgba(59, 130, 246, 0.06)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center bg-blue-500 text-sm font-bold text-white">G</div>
            <div>
              <p className="text-sm font-bold text-blue-400">Google Cloud</p>
              <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Connect a service account for live GCP scans.</p>
            </div>
          </div>
          {connections.gcp ? <Check className="h-4 w-4 text-emerald-400" /> : <Cloud className="h-4 w-4 text-blue-300" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/settings" className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background: "#3b82f6", color: "#fff" }}>
            <KeyRound className="h-3.5 w-3.5" />
            Connect service account
          </Link>
          <span className="inline-flex items-center px-3 py-2 text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>
            Google OAuth linking planned
          </span>
        </div>
      </div>
      <div className="border p-4 space-y-3" style={{ borderColor: "rgba(249, 115, 22, 0.28)", background: "rgba(249, 115, 22, 0.06)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center bg-orange-500 text-sm font-bold text-white">A</div>
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--amber)" }}>Amazon Web Services</p>
              <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Use access keys by default, or switch to Role ARN for AssumeRole setups.</p>
            </div>
          </div>
          {connections.aws ? <Check className="h-4 w-4 text-emerald-400" /> : <ShieldCheck className="h-4 w-4 text-orange-300" />}
        </div>
        <Link href="/dashboard/settings" className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background: "var(--green)", color: "var(--bg)" }}>
          <ShieldCheck className="h-3.5 w-3.5" />
          Connect access keys
        </Link>
      </div>
    </section>
  );
}

function DashboardViewSwitch({
  activeView,
  connections,
  onChange,
  onConnect,
}: {
  activeView: DashboardView;
  connections: CloudConnections;
  onChange: (view: DashboardView) => void;
  onConnect: () => void;
}) {
  const items: { view: DashboardView; label: string; connected: boolean }[] = [
    { view: "gcp", label: "GCP", connected: connections.gcp },
    { view: "aws", label: "AWS", connected: connections.aws },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border px-3 py-2" style={{ borderColor: "var(--border-dim)", background: "#050505" }}>
      <div>
        <p className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
          // Dashboard view
        </p>
        <p className="mt-1 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          Switch between GCP and AWS without leaving the main dashboard.
        </p>
      </div>
      <div className="flex gap-2">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => item.connected ? onChange(item.view) : onConnect()}
            className="px-3 py-2 text-xs font-bold tracking-widest transition-opacity hover:opacity-90"
            style={{
              border: "1px solid var(--border-dim)",
              background: activeView === item.view ? "var(--green)" : "transparent",
              color: activeView === item.view ? "var(--bg)" : item.connected ? "var(--text-muted)" : "var(--amber)",
              opacity: item.connected ? 1 : 0.75,
            }}
            title={item.connected ? `Show ${item.label}` : `Connect ${item.label} in Settings`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DashboardClient({
  initialView = "gcp",
  demoMode = false,
}: {
  initialView?: DashboardView;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const [results, setResults] = useState<QueryResult[]>([]);
  const [scanVersion, setScanVersion] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [hasAiKey, setHasAiKey] = useState<boolean | null>(null);
  const [gcpCredsRequired, setGcpCredsRequired] = useState(false);
  const [cloudConnections, setCloudConnections] = useState<CloudConnections | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>(initialView);
  const [demoSnapshot, setDemoSnapshot] = useState<object | null>(() => getDemoGcpSnapshot());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncLogOpen, setSyncLogOpen] = useState(true);
  const [askAiOpen, setAskAiOpen] = useState(true);
  const { tasks, startGcpScan, clearFinishedTasks, clearAllTasks } = useTaskCenter();
  const hasLoadedInitialSnapshotRef = useRef(false);
  const scanRequestCountRef = useRef(0);
  const taskCount = tasks.length;
  const finishedTaskCount = tasks.filter((task) => task.status === "completed" || task.status === "failed").length;

  const handleViewChange = useCallback((view: DashboardView) => {
    setActiveView(view);
    router.replace(view === "aws" ? "/dashboard?cloud=aws" : "/dashboard?cloud=gcp", { scroll: false });
  }, [router]);

  const handleCloudConnect = useCallback(() => {
    router.push("/dashboard/settings");
  }, [router]);

  const appendSyncLog = useCallback((message: string, detail?: Record<string, unknown>) => {
    const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
    const line = `${new Date().toLocaleTimeString()} ${message}${suffix}`;
    setSyncLog((current) => [line, ...current].slice(0, 8));
  }, []);

  const triggerScan = useCallback((reason = "manual") => {
    scanRequestCountRef.current += 1;
    const requestNumber = scanRequestCountRef.current;
    const demoCreds = getDemoCredentials();
    if (reason === "manual") setSyncLog([]);
    if (!demoMode && !demoCreds.gcp && (gcpCredsRequired || cloudConnections?.gcp === false)) {
      appendSyncLog("[gcp-dashboard] scan blocked: no GCP credentials configured", { reason });
      console.info("[gcp-dashboard] scan blocked: no GCP credentials configured", { reason });
      setScanning(false);
      setGcpCredsRequired(true);
      return;
    }
    const taskId = startGcpScan(demoCreds.gcp ? { demoCredentials: { gcp: demoCreds.gcp } } : {});
    appendSyncLog(`[gcp-dashboard] scan requested #${requestNumber}`, {
      reason,
      taskId,
      hasDemoCredentials: Boolean(demoCreds.gcp),
    });
    console.info(`[gcp-dashboard] scan requested #${requestNumber}`, {
      reason,
      taskId,
      hasDemoCredentials: Boolean(demoCreds.gcp),
    });
    setActiveTaskId(taskId);
    setScanning(true);
  }, [appendSyncLog, cloudConnections?.gcp, demoMode, gcpCredsRequired, startGcpScan]);

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d) => setHasAiKey((d.keys ?? []).length > 0))
      .catch(() => setHasAiKey(null));
  }, []);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (hasLoadedInitialSnapshotRef.current) return;
    hasLoadedInitialSnapshotRef.current = true;

    const demoCreds = getDemoCredentials();
    if (demoCreds.gcp || demoCreds.aws) {
      setCloudConnections({ gcp: Boolean(demoCreds.gcp), aws: Boolean(demoCreds.aws) });
      if (!demoCreds.gcp && demoCreds.aws) {
        setActiveView("aws");
        return;
      }
    }

    if (demoMode) {
      setCloudConnections({ gcp: true, aws: true });
      setGcpCredsRequired(false);
      console.info("[gcp-dashboard] loading demo GCP snapshot");
      appendSyncLog("[gcp-dashboard] loading demo GCP data");
      fetch("/api/scan")
        .then((r) => r.json())
        .then((data) => {
          appendSyncLog("[gcp-dashboard] demo GCP snapshot loaded", {
            hasSnapshot: Boolean(data.snapshot),
            fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
          });
          if (data.snapshot) {
            setDemoGcpSnapshot(data.snapshot);
            setDemoSnapshot(data.snapshot);
            saveSnapshot(data.snapshot as GcpSnapshot);
          }
        })
        .catch((error) => {
          appendSyncLog("[gcp-dashboard] failed to load demo GCP data", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    // If demo credentials are already stored in sessionStorage, trigger a real scan immediately
    if (demoCreds.gcp) {
      setGcpCredsRequired(false);
      triggerScan("initial_demo_credentials");
      return;
    }
    let hasGcpServiceAccount = false;
    console.info("[gcp-dashboard] loading cached GCP snapshot");
    appendSyncLog("[gcp-dashboard] checking GCP credentials");
    fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((data: { credentials?: { provider: string }[] }) => {
        const providers = data.credentials ?? [];
        hasGcpServiceAccount = providers.some((credential) => credential.provider === "gcp");
        setCloudConnections({
          gcp: hasGcpServiceAccount,
          aws: providers.some((credential) => credential.provider === "aws"),
        });
        appendSyncLog("[gcp-dashboard] GCP credential state", {
          serviceAccountConfigured: hasGcpServiceAccount,
          googleSessionFallback: false,
        });
        return fetch("/api/scan");
      })
      .then((r) => r.json())
      .then((data) => {
        appendSyncLog("[gcp-dashboard] cached GCP snapshot loaded", {
          hasSnapshot: Boolean(data.snapshot),
          fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
        });
        console.info("[gcp-dashboard] cached GCP snapshot loaded", {
          hasSnapshot: Boolean(data.snapshot),
          fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
        });
        if (!data.snapshot && !hasGcpServiceAccount) {
          setGcpCredsRequired(true);
          appendSyncLog("[gcp-dashboard] no saved GCP service account; connect one before syncing");
          return;
        }
        if (!data.snapshot) triggerScan("initial_missing_snapshot");
        if (data.snapshot?.snapshotId) saveSnapshot(data.snapshot as GcpSnapshot);
      })
      .catch((error) => {
        appendSyncLog("[gcp-dashboard] failed to load GCP snapshot", {
          error: error instanceof Error ? error.message : String(error),
        });
        setCloudConnections((current) => current ?? { gcp: false, aws: false });
      });
  }, [appendSyncLog, demoMode, triggerScan]);

  useEffect(() => {
    const id = setInterval(() => triggerScan("interval_10m"), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [triggerScan]);

  useEffect(() => {
    if (!activeTaskId) return;
    const task = tasks.find((item) => item.id === activeTaskId);
    if (!task) return;
    console.info("[gcp-dashboard] active GCP task status", {
      taskId: task.id,
      status: task.status,
      percent: task.percent,
      progressCount: task.progress.length,
      latestMessage: task.progress.at(-1)?.message ?? null,
    });
    appendSyncLog("[gcp-dashboard] active GCP task status", {
      taskId: task.id,
      status: task.status,
      percent: task.percent,
      latestMessage: task.progress.at(-1)?.message ?? null,
    });
    if (task.status === "running" || task.status === "queued") {
      setScanning(true);
      return;
    }

    setScanning(false);

    if (task.status === "completed" && task.kind === "gcp_scan") {
      if (task.result?.snapshot) {
        setDemoGcpSnapshot(task.result.snapshot);
        setDemoSnapshot(task.result.snapshot);
      }
      if (!demoMode && task.result?.credentialsRequired) {
        setGcpCredsRequired(true);
      } else {
        setGcpCredsRequired(false);
        setScanVersion((v) => v + 1);
      }
      appendSyncLog("[gcp-dashboard] fresh GCP data fetched", {
        fetchedAt: task.result?.fetchedAt ?? null,
        ...(task.result?.snapshotSummary ?? {}),
      });
    } else if (task.status === "failed" && task.kind === "gcp_scan") {
      const noCredentials = task.error?.toLowerCase().includes("no gcp credentials") ||
        task.error?.toLowerCase().includes("session login required") ||
        task.error?.toLowerCase().includes("session expired");
      if (!demoMode && noCredentials) {
        setGcpCredsRequired(true);
        appendSyncLog(task.error ?? "[api/scan] no GCP credentials configured", { taskId: task.id });
      } else {
        setGcpCredsRequired(false);
      }
    }
  }, [activeTaskId, appendSyncLog, demoMode, tasks]);

  function handleResult(result: QueryResult) {
    setResults((prev) => [result, ...prev]);
    if (result.workflow?.autoRunTask === "gcp_scan") {
      appendSyncLog("[gcp-dashboard] Ask AI requested a GCP scan", { query: result.query });
      startGcpScan();
    }
  }

  const effectiveConnections = cloudConnections ?? { gcp: false, aws: false };
  const hasAnyConnection = effectiveConnections.gcp || effectiveConnections.aws;

  useEffect(() => {
    if (!cloudConnections) return;
    if (!cloudConnections.gcp && cloudConnections.aws) {
      setActiveView("aws");
    } else if (cloudConnections.gcp && !cloudConnections.aws) {
      setActiveView("gcp");
    }
  }, [cloudConnections]);

  if (!cloudConnections) {
    return (
      <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
        <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">
          <div className="border p-4" style={{ borderColor: "var(--border-dim)", background: "#050505" }}>
            <p className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
              // Checking cloud connections
            </p>
            <p className="mt-2 text-sm font-mono" style={{ color: "var(--text-muted)" }}>
              Loading dashboard state...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAnyConnection) {
    return (
      <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
        <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">
          <div className="border p-4" style={{ borderColor: "var(--border-dim)", background: "#050505" }}>
            <p className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
              // Connect a cloud provider
            </p>
            <p className="mt-2 text-sm font-mono" style={{ color: "var(--text-muted)" }}>
              Connect AWS or GCP before the dashboard shows cloud inventory, findings, compliance, and AI query tools.
            </p>
          </div>
          <CloudConnectionCards connections={effectiveConnections} />
        </div>
      </div>
    );
  }

  if (activeView === "aws" && effectiveConnections.aws) {
    return (
      <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
        <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">
          <DashboardViewSwitch activeView={activeView} connections={effectiveConnections} onChange={handleViewChange} onConnect={handleCloudConnect} />
          <AwsDashboardClient embedded demoMode={demoMode} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
      <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">
        <DashboardViewSwitch activeView={activeView} connections={effectiveConnections} onChange={handleViewChange} onConnect={handleCloudConnect} />
        <SnapshotStats
          scanVersion={scanVersion}
          onSyncRequest={() => triggerScan("manual")}
          isSyncing={scanning}
          overrideSnapshot={demoSnapshot}
          syncDisabled={gcpCredsRequired}
          syncDisabledReason="Add GCP credentials in Settings before syncing GCP."
        />
        {gcpCredsRequired && (
          <div
            className="px-3 py-2 text-xs font-mono"
            style={{ border: "1px solid #5c3b00", background: "#0d0905", color: "#ffb020" }}
          >
            // WARN: No GCP credentials configured.{" "}
            <Link href="/dashboard/settings" style={{ color: "#ffb020", textDecoration: "underline" }}>
              [ADD GCP CREDENTIALS]
            </Link>
          </div>
        )}
        {syncLog.length > 0 && (
          <div className="p-3 space-y-2" style={{ border: "1px solid var(--border-dim)", background: "#050505" }}>
            <button
              type="button"
              onClick={() => setSyncLogOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
                // GCP sync log
              </span>
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
                {syncLog.length} entries
                {syncLogOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </span>
            </button>
            {syncLogOpen && syncLog.map((line, index) => (
              <p key={`${line}-${index}`} className="text-[10px] font-mono break-all" style={{ color: index === 0 ? "#e5e7eb" : "#6b7280" }}>
                {line}
              </p>
            ))}
          </div>
        )}

        <section className="space-y-3">
          {demoMode ? (
            <DemoAiNotice />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setAskAiOpen((open) => !open)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
                    // GCP Ask AI
                  </p>
                  <p className="mt-1 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    Query the latest GCP snapshot: IAM, Cloud Storage, GKE, Compute Engine, Cloud Run, Cloud SQL, BigQuery, Pub/Sub, Secret Manager, firewall rules, findings, and compliance.
                  </p>
                </div>
                <span className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
                  {askAiOpen ? "minimize" : "expand"}
                  {askAiOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
              </button>
              {askAiOpen && (
                <>
                  <QueryBox
                    apiEndpoint="/api/query"
                    onResult={handleResult}
                    suggestedQueries={GCP_SUGGESTED_QUERIES}
                    placeholder="Ask anything about your GCP infrastructure..."
                  />
                  {results.length > 0 && (
                    <div className="space-y-3">
                      {results.map((result, index) => (
                        <ResultCard key={`${result.query}-${result.fetchedAt}-${index}`} result={result} index={index} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {/* Status bar */}
      <div
        className="flex items-center justify-between mt-8 px-3 py-1.5 text-xs"
        style={{ border: "1px solid #005c16", background: "#0a0a0a" }}
      >
        <div className="flex items-center gap-4">
          {gcpCredsRequired && (
            <span style={{ color: "#ffaa00" }}>
              // WARN: No GCP credentials —{" "}
              <Link href="/dashboard/settings" style={{ color: "#ffaa00", textDecoration: "underline" }}>
                [GO TO SETTINGS]
              </Link>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "#005c16" }}>
          {finishedTaskCount > 0 && (
            <button
              type="button"
              onClick={clearFinishedTasks}
              className="uppercase"
              style={{ color: "#ffaa00" }}
            >
              [CLEAR {finishedTaskCount} FINISHED]
            </button>
          )}
          {taskCount > 0 && (
            <button
              type="button"
              onClick={clearAllTasks}
              className="uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              [CLEAR ALL TASKS]
            </button>
          )}
          <span style={{ color: scanning ? "#ffaa00" : "#005c16" }}>
            {scanning ? "// SYNCING GCP..." : "// SYSTEM ONLINE"}
          </span>
          <span className={scanning ? "blink" : ""} style={{ color: scanning ? "#ffaa00" : "#00ff41" }}>
            ■
          </span>
        </div>
      </div>

    </div>
  );
}
