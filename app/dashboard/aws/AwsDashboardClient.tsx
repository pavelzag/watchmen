"use client";

import { useState, useEffect, useCallback } from "react";
import AwsSnapshotStats from "@/components/AwsSnapshotStats";
import { getDemoCredentials, getDemoAwsSnapshot, setDemoAwsSnapshot } from "@/lib/demo-credentials";
import type { AwsSnapshot } from "@/lib/aws/types";

export default function AwsDashboardClient() {
  const [scanVersion, setScanVersion] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [demoSnapshot, setDemoSnapshot] = useState<AwsSnapshot | null>(() => getDemoAwsSnapshot() as AwsSnapshot | null);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      const demoCreds = getDemoCredentials();
      const body = demoCreds.aws ? { demoCredentials: { aws: demoCreds.aws } } : {};
      const res = await fetch("/api/aws/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { snapshot?: AwsSnapshot };
      if (data.snapshot) {
        setDemoAwsSnapshot(data.snapshot);
        setDemoSnapshot(data.snapshot);
      }
      setScanVersion((v) => v + 1);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (getDemoCredentials().aws) {
      triggerScan();
      return;
    }
    fetch("/api/aws/scan")
      .then((r) => r.json())
      .then((data) => {
        if (!data.snapshot) triggerScan();
      })
      .catch(() => { });
  }, [triggerScan]);

  useEffect(() => {
    const id = setInterval(triggerScan, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [triggerScan]);

  return (
    <div className="min-h-screen p-4 flex flex-col" style={{ background: "#090909" }}>
      <div className="max-w-4xl mx-auto w-full space-y-4 flex-1">

        <AwsSnapshotStats
          scanVersion={scanVersion}
          onSyncRequest={triggerScan}
          isSyncing={scanning}
          overrideSnapshot={demoSnapshot}
        />
      </div>

      {/* Status bar */}
      <div
        className="flex items-center justify-between mt-8 px-3 py-1.5 text-xs"
        style={{ border: "1px solid #005c16", background: "#0a0a0a" }}
      >
        <div className="flex items-center gap-4" />
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
