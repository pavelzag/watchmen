"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import AwsSnapshotStats from "@/components/AwsSnapshotStats";
import QueryBox, { type QueryResult } from "@/components/QueryBox";
import ResultCard from "@/components/ResultCard";
import { getDemoCredentials, getDemoAwsSnapshot, setDemoAwsSnapshot } from "@/lib/demo-credentials";
import type { AwsSnapshot } from "@/lib/aws/types";
import { useTaskCenter } from "@/components/TaskCenterProvider";
import { ChevronDown, ChevronUp } from "lucide-react";
import DemoAiNotice from "@/components/DemoAiNotice";

const AWS_SUGGESTED_QUERIES = [
  "Which S3 buckets are publicly accessible?",
  "List Lambda functions with public invoke policies",
  "Which EC2 instances have public IPs?",
  "Show EKS clusters with public API endpoints",
  "Which security groups are open to the internet?",
  "What can watchmen-scanner access?",
];

export default function AwsDashboardClient({
  embedded = false,
  demoMode = false,
}: {
  embedded?: boolean;
  demoMode?: boolean;
} = {}) {
  const [results, setResults] = useState<QueryResult[]>([]);
  const [scanVersion, setScanVersion] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [awsCredsRequired, setAwsCredsRequired] = useState(false);
  const [demoSnapshot, setDemoSnapshot] = useState<AwsSnapshot | null>(() => getDemoAwsSnapshot() as AwsSnapshot | null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncLogOpen, setSyncLogOpen] = useState(true);
  const [askAiOpen, setAskAiOpen] = useState(true);
  const { tasks, startAwsScan } = useTaskCenter();
  const hasLoadedInitialSnapshotRef = useRef(false);
  const scanRequestCountRef = useRef(0);

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
    if (!demoMode && !demoCreds.aws && awsCredsRequired) {
      appendSyncLog("[aws-dashboard] scan blocked: no AWS credentials configured", { reason });
      console.info("[aws-dashboard] scan blocked: no AWS credentials configured", { reason });
      setScanning(false);
      return;
    }
    const taskId = startAwsScan(demoCreds.aws ? { demoCredentials: { aws: demoCreds.aws } } : {});
    appendSyncLog(`[aws-dashboard] scan requested #${requestNumber}`, {
      reason,
      taskId,
      hasDemoCredentials: Boolean(demoCreds.aws),
    });
    console.info(`[aws-dashboard] scan requested #${requestNumber}`, {
      reason,
      taskId,
      hasDemoCredentials: Boolean(demoCreds.aws),
    });
    setActiveTaskId(taskId);
    setScanning(true);
  }, [appendSyncLog, awsCredsRequired, demoMode, startAwsScan]);

  useEffect(() => {
    if (hasLoadedInitialSnapshotRef.current) return;
    hasLoadedInitialSnapshotRef.current = true;

    if (demoMode) {
      setAwsCredsRequired(false);
      console.info("[aws-dashboard] loading demo AWS snapshot");
      appendSyncLog("[aws-dashboard] loading demo AWS data");
      fetch("/api/aws/scan")
        .then((r) => r.json())
        .then((data) => {
          appendSyncLog("[aws-dashboard] demo AWS snapshot loaded", {
            hasSnapshot: Boolean(data.snapshot),
            fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
          });
          if (data.snapshot) {
            setDemoAwsSnapshot(data.snapshot as AwsSnapshot);
            setDemoSnapshot(data.snapshot as AwsSnapshot);
          }
        })
        .catch((error) => {
          appendSyncLog("[aws-dashboard] failed to load demo AWS data", {
            error: error instanceof Error ? error.message : String(error),
          });
          console.warn("[aws-dashboard] failed to load demo AWS snapshot", error);
        });
      return;
    }

    if (getDemoCredentials().aws) {
      setAwsCredsRequired(false);
      triggerScan("initial_demo_credentials");
      return;
    }
    let hasAwsCredentials = false;
    console.info("[aws-dashboard] loading cached AWS snapshot");
    appendSyncLog("[aws-dashboard] checking AWS credentials");
    fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((data: { credentials?: { provider: string }[] }) => {
        hasAwsCredentials = (data.credentials ?? []).some((credential) => credential.provider === "aws");
        setAwsCredsRequired(!hasAwsCredentials);
        appendSyncLog("[aws-dashboard] AWS credential state", { configured: hasAwsCredentials });
        return fetch("/api/aws/scan");
      })
      .then((r) => r.json())
      .then((data) => {
        appendSyncLog("[aws-dashboard] cached AWS snapshot loaded", {
          hasSnapshot: Boolean(data.snapshot),
          fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
        });
        console.info("[aws-dashboard] cached AWS snapshot loaded", {
          hasSnapshot: Boolean(data.snapshot),
          fetchedAt: data.fetchedAt ?? data.snapshot?.fetchedAt ?? null,
        });
        if (!data.snapshot && hasAwsCredentials) triggerScan("initial_missing_snapshot");
        if (!data.snapshot && !hasAwsCredentials) {
          appendSyncLog("[api/aws/scan] no AWS credentials configured");
        }
      })
      .catch((error) => {
        appendSyncLog("[aws-dashboard] failed to load AWS state", {
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn("[aws-dashboard] failed to load cached AWS snapshot", error);
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
    console.info("[aws-dashboard] active AWS task status", {
      taskId: task.id,
      status: task.status,
      percent: task.percent,
      progressCount: task.progress.length,
      latestMessage: task.progress.at(-1)?.message ?? null,
    });
    appendSyncLog("[aws-dashboard] active AWS task status", {
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

    if (task.status === "completed" && task.kind === "aws_scan") {
      if (task.result?.snapshot) {
        setDemoAwsSnapshot(task.result.snapshot as AwsSnapshot);
        setDemoSnapshot(task.result.snapshot as AwsSnapshot);
      }
      setScanVersion((v) => v + 1);
      setAwsCredsRequired(false);
      appendSyncLog("[aws-dashboard] fresh AWS data fetched", {
        fetchedAt: task.result?.fetchedAt ?? null,
        ...(task.result?.snapshotSummary ?? {}),
      });
    } else if (task.status === "failed" && task.kind === "aws_scan") {
      const noCredentials = task.error?.toLowerCase().includes("no aws credentials");
      if (!demoMode && noCredentials) {
        setAwsCredsRequired(true);
        appendSyncLog(task.error ?? "[api/aws/scan] no AWS credentials configured", { taskId: task.id });
      } else {
        appendSyncLog(task.error ?? "[api/aws/scan] AWS scan failed", { taskId: task.id });
      }
    }
  }, [activeTaskId, appendSyncLog, demoMode, tasks]);

  function handleResult(result: QueryResult) {
    setResults((prev) => [result, ...prev]);
    if (result.workflow?.autoRunTask === "aws_scan") {
      appendSyncLog("[aws-dashboard] Ask AI requested an AWS scan", { query: result.query });
      startAwsScan();
    }
  }

  return (
    <div className={embedded ? "flex flex-col" : "min-h-screen p-4 flex flex-col"} style={{ background: "#090909" }}>
      <div className={embedded ? "w-full space-y-4 flex-1" : "max-w-4xl mx-auto w-full space-y-4 flex-1"}>

        <AwsSnapshotStats
          scanVersion={scanVersion}
          onSyncRequest={() => triggerScan("manual")}
          isSyncing={scanning}
          overrideSnapshot={demoSnapshot}
          syncDisabled={awsCredsRequired}
          syncDisabledReason="Add AWS credentials in Settings before syncing AWS."
        />
        {awsCredsRequired && (
          <div
            className="px-3 py-2 text-xs font-mono"
            style={{ border: "1px solid #5c3b00", background: "#0d0905", color: "#ffb020" }}
          >
            // WARN: No AWS credentials configured.{" "}
            <Link href="/dashboard/settings" style={{ color: "#ffb020", textDecoration: "underline" }}>
              [ADD AWS CREDENTIALS]
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
                // AWS sync log
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
                    // AWS Ask AI
                  </p>
                  <p className="mt-1 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    Query the latest AWS snapshot: IAM, S3, EKS, EC2, Lambda, RDS, Redshift, SNS, Secrets Manager, security groups, findings, and compliance.
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
                    apiEndpoint="/api/aws/query"
                    onResult={handleResult}
                    suggestedQueries={AWS_SUGGESTED_QUERIES}
                    placeholder="Ask anything about your AWS infrastructure..."
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
          {awsCredsRequired && (
            <span style={{ color: "#ffaa00" }}>
              // WARN: No AWS credentials —{" "}
              <Link href="/dashboard/settings" style={{ color: "#ffaa00", textDecoration: "underline" }}>
                [GO TO SETTINGS]
              </Link>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "#005c16" }}>
          <span style={{ color: scanning ? "#ffaa00" : "#005c16" }}>
            {scanning ? "// SYNCING AWS..." : "// SYSTEM ONLINE"}
          </span>
          <span className={scanning ? "blink" : ""} style={{ color: scanning ? "#ffaa00" : "#00ff41" }}>
            ■
          </span>
        </div>
      </div>

    </div>
  );
}
