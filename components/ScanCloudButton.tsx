"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskCenter } from "@/components/TaskCenterProvider";

interface Props {
  onScanComplete: () => void;
  variant?: "terminal" | "modern";
}

type Cloud = "gcp" | "aws";

const COOLDOWN_MS = 60_000;
const STORAGE_KEY = "watchmen.last-scan-at";

function useLastScan() {
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    setLastScanAt(raw ? Number(raw) : null);
  }, []);

  function recordScan() {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY, String(now));
    setLastScanAt(now);
  }

  return { lastScanAt, recordScan };
}

function useCountdown(fromMs: number | null, durationMs: number) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!fromMs) { setRemaining(0); return; }
    function tick() {
      const elapsed = Date.now() - fromMs!;
      const r = Math.max(0, durationMs - elapsed);
      setRemaining(r);
      return r;
    }
    const r = tick();
    if (r === 0) return;
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [fromMs, durationMs]);

  return remaining;
}

export default function ScanCloudButton({ onScanComplete, variant = "terminal" }: Props) {
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [scanning, setScanning] = useState(false);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const { tasks, startGcpScan, startAwsScan } = useTaskCenter();
  const { lastScanAt, recordScan } = useLastScan();
  const cooldownRemaining = useCountdown(lastScanAt, COOLDOWN_MS);

  const inCooldown = cooldownRemaining > 0;

  useEffect(() => {
    const active: Cloud[] = ["gcp"];
    fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((data: { credentials?: { provider: string }[] }) => {
        const providers = (data.credentials ?? []).map((c) => c.provider);
        if (providers.includes("aws")) active.push("aws");
        setClouds([...active]);
      })
      .catch(() => setClouds(active));
  }, []);

  async function scan() {
    setScanning(true);
    const nextTaskIds = clouds.map((cloud) =>
      cloud === "gcp" ? startGcpScan() : startAwsScan()
    );
    setTaskIds(nextTaskIds);
  }

  useEffect(() => {
    if (taskIds.length === 0) return;
    const startedTasks = tasks.filter((task) => taskIds.includes(task.id));
    if (startedTasks.length === 0) return;
    const allFinished = startedTasks.every((task) => task.status === "completed" || task.status === "failed");
    if (!allFinished) return;

    setScanning(false);
    recordScan();
    onScanComplete();
    setTaskIds([]);
  }, [taskIds, tasks, onScanComplete]);

  if (clouds.length === 0) return null;

  const label = clouds.length === 2
    ? "SCAN CLOUD"
    : clouds[0] === "gcp" ? "SCAN GCP" : "SCAN AWS";

  const isDisabled = scanning || inCooldown;

  const cooldownSecs = Math.ceil(cooldownRemaining / 1000);

  function lastScannedLabel(): string | null {
    if (!lastScanAt || scanning) return null;
    const mins = Math.floor((Date.now() - lastScanAt) / 60_000);
    if (mins < 1) return "scanned just now";
    if (mins === 1) return "scanned 1 min ago";
    return `scanned ${mins} min ago`;
  }

  const scannedLabel = lastScannedLabel();

  if (variant === "modern") {
    return (
      <div className="relative inline-flex group">
        <button
          onClick={scan}
          disabled={isDisabled}
          title={scannedLabel ?? undefined}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors",
            isDisabled
              ? "border-slate-600 text-slate-500 cursor-not-allowed"
              : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", scanning && "animate-spin")} />
          {scanning ? "Scanning…" : inCooldown ? `Wait ${cooldownSecs}s` : label}
        </button>
        {scannedLabel && (
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-mono tabular-nums text-slate-300 shadow-lg group-hover:block">
            {scannedLabel}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-flex group">
      <button
        onClick={scan}
        disabled={isDisabled}
        title={scannedLabel ?? undefined}
        className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
        style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: isDisabled ? 0.5 : 1 }}
      >
        <RefreshCw className={`w-3 h-3 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Scanning…" : inCooldown ? `Wait ${cooldownSecs}s` : label}
      </button>
      {scannedLabel && (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-mono tabular-nums text-slate-300 shadow-lg group-hover:block">
          {scannedLabel}
        </div>
      )}
    </div>
  );
}
