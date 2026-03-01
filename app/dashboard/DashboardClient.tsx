"use client";

import { useState, useEffect, useCallback } from "react";
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

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      await fetch("/api/scan", { method: "POST" });
      setScanVersion((v) => v + 1);
    } finally {
      setScanning(false);
    }
  }, []);

  // On mount: check if a snapshot exists; if not, trigger one immediately
  useEffect(() => {
    fetch("/api/scan")
      .then((r) => r.json())
      .then((data) => {
        if (!data.snapshot) {
          triggerScan();
        }
        // Auto-save to history if snapshot exists
        if (data.snapshot?.snapshotId) {
          saveSnapshot(data.snapshot as GcpSnapshot);
        }
      })
      .catch(() => {
        // silently ignore — SnapshotStats will show the error
      });
  }, [triggerScan]);

  // 10-minute auto-refresh
  useEffect(() => {
    const id = setInterval(triggerScan, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [triggerScan]);

  function handleResult(result: QueryResult) {
    setResults((prev) => [result, ...prev]);
  }

  return (
    <div className="space-y-8">
      {/* Stats bar */}
      <SnapshotStats
        scanVersion={scanVersion}
        onSyncRequest={triggerScan}
        isSyncing={scanning}
      />

      <div className="border-t border-slate-800" />

      {/* Query section */}
      <div className="space-y-2">
        <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          Natural Language Query
        </h2>
        <QueryBox onResult={handleResult} />
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Results ({results.length})
            </h2>
            <button
              onClick={() => setResults([])}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="space-y-4">
            {results.map((r, i) => (
              <ResultCard key={`${r.fetchedAt}-${i}`} result={r} index={i} />
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && (
        <div className="text-center py-12 text-slate-600">
          <p className="text-sm">Ask a question above to see results here.</p>
        </div>
      )}
    </div>
  );
}
