"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onScanComplete: () => void;
  variant?: "terminal" | "modern";
}

type Cloud = "gcp" | "aws";

export default function ScanCloudButton({ onScanComplete, variant = "terminal" }: Props) {
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    // GCP is always available via Google OAuth session token.
    // AWS requires stored credentials — check the credentials API.
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

  if (clouds.length === 0) return null;

  const label = clouds.length === 2
    ? "SCAN CLOUD"
    : clouds[0] === "gcp" ? "SCAN GCP" : "SCAN AWS";

  async function scan() {
    setScanning(true);
    try {
      await Promise.all(
        clouds.map((cloud) =>
          fetch(cloud === "gcp" ? "/api/scan" : "/api/aws/scan", { method: "POST" })
        )
      );
    } finally {
      setScanning(false);
      onScanComplete();
    }
  }

  if (variant === "modern") {
    return (
      <button
        onClick={scan}
        disabled={scanning}
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors",
          scanning
            ? "border-slate-600 text-slate-500 cursor-not-allowed"
            : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
        )}
      >
        <RefreshCw className={cn("w-3.5 h-3.5", scanning && "animate-spin")} />
        {scanning ? "Scanning…" : label}
      </button>
    );
  }

  return (
    <button
      onClick={scan}
      disabled={scanning}
      className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
      style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: scanning ? 0.6 : 1 }}
    >
      <RefreshCw className={`w-3 h-3 ${scanning ? "animate-spin" : ""}`} />
      {scanning ? "Scanning…" : label}
    </button>
  );
}
