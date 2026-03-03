"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import QueryBox, { type QueryResult } from "@/components/QueryBox";
import ResultCard from "@/components/ResultCard";
import SnapshotStats from "@/components/SnapshotStats";
import { Trash2 } from "lucide-react";
import { saveSnapshot } from "@/lib/snapshot-history";
import type { GcpSnapshot } from "@/lib/gcp/types";

export default function DashboardClient() {
  const [results, setResults] = useState<QueryResult[]>([]);
  const [scanVersion, setScanVersion] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [hasAiKey, setHasAiKey] = useState<boolean | null>(null);
  const [gcpCredsRequired, setGcpCredsRequired] = useState(false);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      if (res.status === 422) {
        const data = await res.json();
        if (data.credentialsRequired) {
          setGcpCredsRequired(true);
          return;
        }
      }
      setGcpCredsRequired(false);
      setScanVersion((v) => v + 1);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d) => setHasAiKey((d.keys ?? []).length > 0))
      .catch(() => setHasAiKey(null));
  }, []);

  useEffect(() => {
    fetch("/api/scan")
      .then((r) => r.json())
      .then((data) => {
        if (!data.snapshot) triggerScan();
        if (data.snapshot?.snapshotId) saveSnapshot(data.snapshot as GcpSnapshot);
      })
      .catch(() => { });
  }, [triggerScan]);

  useEffect(() => {
    const id = setInterval(triggerScan, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [triggerScan]);

  function handleResult(result: QueryResult) {
    setResults((prev) => [result, ...prev]);
  }

  return (
    <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
      <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">
        <p className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
          // CLOUD BRAIN QUERY
        </p>

        <QueryBox onResult={handleResult} />

        {results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest" style={{ color: "#00aa2b" }}>
                // QUERY LOG ({results.length} entries)
              </span>
              <button
                onClick={() => setResults([])}
                className="flex items-center gap-1 text-xs uppercase tracking-widest transition-colors px-2 py-1"
                style={{ color: "#ff3333", border: "1px solid #440000" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#ff3333";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#440000";
                }}
              >
                <Trash2 className="w-3 h-3" />
                [CLEAR LOG]
              </button>
            </div>
            <div className="space-y-3">
              {results.map((r, i) => (
                <ResultCard key={`${r.fetchedAt}-${i}`} result={r} index={i} />
              ))}
            </div>
          </div>
        )}

        {results.length === 0 && (
          <div className="py-8 text-center" style={{ color: "#005c16" }}>
            <p className="text-xs">// No queries executed. Type a command above.</p>
          </div>
        )}

        <SnapshotStats
          scanVersion={scanVersion}
          onSyncRequest={triggerScan}
          isSyncing={scanning}
        />
      </div>

      {/* Status bar */}
      <div
        className="flex items-center justify-between mt-8 px-3 py-1.5 text-xs"
        style={{ border: "1px solid #005c16", background: "#0a0a0a" }}
      >
        <div className="flex items-center gap-4">
          {hasAiKey === false && (
            <span style={{ color: "#ffaa00" }}>
              // WARN: No AI key configured —{" "}
              <Link href="/dashboard/settings" style={{ color: "#ffaa00", textDecoration: "underline" }}>
                [CONFIGURE]
              </Link>
            </span>
          )}
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
          <span style={{ color: scanning ? "#ffaa00" : "#005c16" }}>
            {scanning ? "// SYNCING GCP..." : "// SYSTEM ONLINE"}
          </span>
          <span className={scanning ? "blink" : ""} style={{ color: scanning ? "#ffaa00" : "#00ff41" }}>
            ■
          </span>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-3 text-xs" style={{ color: "#003010" }}>
        Conceived with love by Pavel Zagalsky 2026
      </footer>
    </div>
  );
}
