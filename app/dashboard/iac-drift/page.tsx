"use client";

import { useState } from "react";
import { GitBranch, Upload, AlertTriangle, Ghost, Trash2, RefreshCw } from "lucide-react";
import type { DriftItem } from "@/lib/iac-drift";

const DRIFT_STYLES = {
  phantom: {
    label: "PHANTOM",
    description: "Exists live but NOT in Terraform — shadow infrastructure",
    border: "#ef4444",
    bg: "#1a0606",
    text: "#f87171",
  },
  orphaned: {
    label: "ORPHANED",
    description: "In Terraform state but NOT found live",
    border: "#f59e0b",
    bg: "#1a1206",
    text: "#fbbf24",
  },
};

function DriftCard({ item }: { item: DriftItem }) {
  const s = DRIFT_STYLES[item.driftType];
  const Icon = item.driftType === "phantom" ? Ghost : Trash2;
  return (
    <div
      style={{
        border: `1px solid ${s.border}33`,
        background: "#09090b",
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "6px 8px",
          border: `1px solid ${s.border}44`,
          background: s.bg,
        }}
      >
        <Icon style={{ color: s.text, width: 14, height: 14 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            style={{
              fontSize: 8,
              letterSpacing: 2,
              fontFamily: "monospace",
              color: s.text,
              border: `1px solid ${s.border}44`,
              background: s.bg,
              padding: "1px 6px",
            }}
          >
            {s.label}
          </span>
          <span style={{ fontSize: 9, color: "#6b7280", fontFamily: "monospace" }}>
            {item.tfType}
          </span>
          <span
            style={{
              fontSize: 9,
              color: item.cloud === "gcp" ? "#4ade80" : "#fb923c",
              fontFamily: "monospace",
              border: `1px solid currentColor`,
              padding: "0 4px",
              opacity: 0.7,
            }}
          >
            {item.cloud.toUpperCase()}
          </span>
        </div>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb", fontFamily: "monospace", marginBottom: 4 }}>
          {item.resourceId}
        </p>
        <p style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.5 }}>
          {item.description}
        </p>
      </div>
    </div>
  );
}

// ── Sample state for demo purposes ────────────────────────────────────────────
const SAMPLE_STATE = JSON.stringify({
  version: 4,
  terraform_version: "1.7.0",
  resources: [
    {
      type: "google_storage_bucket",
      name: "main_assets",
      provider: "provider[\"registry.terraform.io/hashicorp/google\"]",
      instances: [{ attributes: { name: "main-assets-bucket" } }],
    },
    {
      type: "google_compute_firewall",
      name: "allow_ssh",
      provider: "provider[\"registry.terraform.io/hashicorp/google\"]",
      instances: [{ attributes: { name: "allow-ssh-from-office" } }],
    },
    {
      type: "google_compute_instance",
      name: "api_server",
      provider: "provider[\"registry.terraform.io/hashicorp/google\"]",
      instances: [{ attributes: { name: "prod-api-server" } }],
    },
    {
      type: "aws_s3_bucket",
      name: "logs",
      provider: "provider[\"registry.terraform.io/hashicorp/aws\"]",
      instances: [{ attributes: { bucket: "prod-access-logs" } }],
    },
    {
      type: "aws_lambda_function",
      name: "authorizer",
      provider: "provider[\"registry.terraform.io/hashicorp/aws\"]",
      instances: [{ attributes: { function_name: "prod-api-authorizer" } }],
    },
  ],
}, null, 2);

export default function IacDriftPage() {
  const [stateContent, setStateContent] = useState("");
  const [driftItems, setDriftItems] = useState<DriftItem[] | null>(null);
  const [tfResourceCount, setTfResourceCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze(content?: string) {
    const toAnalyze = content ?? stateContent;
    if (!toAnalyze.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/iac-drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateContent: toAnalyze }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setDriftItems(data.driftItems);
      setTfResourceCount(data.tfResourceCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setStateContent(SAMPLE_STATE);
    setDriftItems(null);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setStateContent(text);
    setDriftItems(null);
  }

  const phantomCount = driftItems?.filter((d) => d.driftType === "phantom").length ?? 0;
  const orphanedCount = driftItems?.filter((d) => d.driftType === "orphaned").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase flex items-center gap-2" style={{ color: "var(--green)" }}>
            <GitBranch className="w-4 h-4" />
            // IaC Drift Detection
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
            Compare live cloud resources against your Terraform state to surface shadow infrastructure and orphaned resources.
          </p>
        </div>
      </div>

      {/* Input area */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <p style={{ fontSize: 9, letterSpacing: 3, color: "var(--text-muted)", fontFamily: "monospace" }}>
            // PASTE OR UPLOAD terraform.tfstate
          </p>
          <label
            className="flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer transition-colors"
            style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
          >
            <Upload className="w-3 h-3" />
            Upload file
            <input type="file" accept=".json,.tfstate" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            onClick={loadSample}
            className="flex items-center gap-1.5 px-3 py-1 text-xs transition-colors"
            style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
          >
            Load sample
          </button>
        </div>

        <textarea
          value={stateContent}
          onChange={(e) => setStateContent(e.target.value)}
          placeholder={'{\n  "version": 4,\n  "resources": [...]\n}'}
          rows={10}
          className="w-full px-4 py-3 bg-transparent text-xs outline-none font-mono resize-none"
          style={{
            border: "1px solid var(--border-dim)",
            color: "var(--text-primary)",
            background: "var(--bg-card)",
          }}
        />

        {error && (
          <p className="text-xs font-mono text-red-400">!! {error}</p>
        )}

        <button
          onClick={() => analyze()}
          disabled={!stateContent.trim() || loading}
          className="flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest font-bold transition-all"
          style={
            stateContent.trim() && !loading
              ? { background: "var(--green)", color: "var(--bg)" }
              : { border: "1px solid var(--border-dim)", color: "var(--border-dim)", opacity: 0.5 }
          }
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Analyzing…" : "Analyze Drift"}
        </button>
      </div>

      {/* Results */}
      {driftItems !== null && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "TF Resources", value: tfResourceCount, color: "var(--green)" },
              { label: "Phantom (shadow)", value: phantomCount, color: "#ef4444" },
              { label: "Orphaned", value: orphanedCount, color: "#f59e0b" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)", padding: "12px 16px" }}>
                <p style={{ fontSize: 9, letterSpacing: 3, color: "var(--border-dim)", fontFamily: "monospace" }}>{label.toUpperCase()}</p>
                <p style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.2 }}>{value}</p>
              </div>
            ))}
          </div>

          {driftItems.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-20 gap-4"
              style={{ border: "1px solid var(--border-dim)" }}
            >
              <AlertTriangle className="w-8 h-8" style={{ color: "var(--green)" }} />
              <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
                No drift detected — live resources match Terraform state.
              </p>
            </div>
          ) : (
            <>
              {/* Phantom section */}
              {phantomCount > 0 && (
                <div>
                  <p style={{ fontSize: 9, letterSpacing: 3, color: "#ef4444", fontFamily: "monospace", marginBottom: 10 }}>
                    // PHANTOM INFRASTRUCTURE ({phantomCount}) — exists live, not in Terraform
                  </p>
                  <div className="space-y-2">
                    {driftItems
                      .filter((d) => d.driftType === "phantom")
                      .map((item) => <DriftCard key={item.id} item={item} />)}
                  </div>
                </div>
              )}

              {/* Orphaned section */}
              {orphanedCount > 0 && (
                <div>
                  <p style={{ fontSize: 9, letterSpacing: 3, color: "#f59e0b", fontFamily: "monospace", marginBottom: 10 }}>
                    // ORPHANED RESOURCES ({orphanedCount}) — in Terraform, not found live
                  </p>
                  <div className="space-y-2">
                    {driftItems
                      .filter((d) => d.driftType === "orphaned")
                      .map((item) => <DriftCard key={item.id} item={item} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
