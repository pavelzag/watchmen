"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  "Connecting to GCP…",
  "Fetching IAM policies…",
  "Fetching service accounts…",
  "Fetching storage buckets…",
  "Fetching GKE clusters…",
  "Fetching virtual machines…",
  "Fetching Cloud Run services…",
  "Fetching Cloud SQL instances…",
  "Fetching BigQuery datasets…",
  "Fetching Pub/Sub topics…",
  "Fetching secrets…",
  "Fetching firewall rules…",
  "Computing security findings…",
  "Saving snapshot…",
];

const STEP_DURATION = 2400; // ms per step — ~33s total for 14 steps

interface ScanProgressProps {
  isScanning: boolean;
}

export default function ScanProgress({ isScanning }: ScanProgressProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isScanning) {
      setVisible(true);
      setDone(false);
      setStepIndex(0);
      const id = setInterval(() => {
        setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      }, STEP_DURATION);
      return () => clearInterval(id);
    } else if (visible) {
      // Scan just finished — snap to 100%, then fade out
      setDone(true);
      const t = setTimeout(() => {
        setVisible(false);
        setDone(false);
        setStepIndex(0);
      }, 1000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning]);

  if (!visible) return null;

  const pct = done ? 100 : Math.round((stepIndex / (STEPS.length - 1)) * 92) + 2;
  const label = done ? "Snapshot saved!" : STEPS[stepIndex];

  return (
    <div className="rounded-xl border border-sky-500/25 bg-gradient-to-br from-sky-500/8 to-violet-500/8 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ScanLine className={cn("w-3.5 h-3.5 text-sky-400 shrink-0", !done && "animate-pulse")} />
        <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-sky-300 font-medium truncate">{label}</span>
          <span className={cn(
            "text-xs tabular-nums font-mono shrink-0 transition-colors duration-300",
            done ? "text-emerald-400" : "text-slate-400"
          )}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Progress track */}
      <div className="relative h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
        {/* Fill */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all ease-out",
            done
              ? "bg-emerald-500 duration-300"
              : "bg-gradient-to-r from-sky-500 via-violet-500 to-sky-400 duration-700"
          )}
          style={{ width: `${pct}%` }}
        />
        {/* Shimmer overlay */}
        {!done && (
          <div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
            style={{ left: 0 }}
          />
        )}
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-1">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-0.5 flex-1 rounded-full transition-all duration-500",
              i < stepIndex || done
                ? "bg-sky-500/70"
                : i === stepIndex
                ? "bg-sky-400 animate-pulse"
                : "bg-slate-700"
            )}
          />
        ))}
      </div>
    </div>
  );
}
