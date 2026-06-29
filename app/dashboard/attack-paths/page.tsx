"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  Globe, Flame, Server, Database, Key, Shield, ChevronRight,
  AlertTriangle, RefreshCw, Lock, User, Cloud, HardDrive, GitPullRequest,
  Sparkles, Loader2, ChevronDown, ChevronUp, AlertCircle,
} from "lucide-react";
import { computeAttackPaths, type AttackNode, type AttackPath } from "@/lib/gcp/attack-paths";
import type { AwsSecurityFinding, AwsSnapshot } from "@/lib/aws/types";
import { computeAwsFindings } from "@/lib/aws-findings";
import RemediateModal from "./RemediateModal";
import ScanCloudButton from "@/components/ScanCloudButton";
import { remediationTargetFromAttackPath } from "@/lib/github/remediation-targets";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";
import { linkifyText } from "@/lib/utils/linkify";
import CopyAiResponseButton from "@/components/CopyAiResponseButton";
import { useDemoMode } from "@/components/DemoModeProvider";
import type { ResourceItem } from "@/lib/claude/query-processor";

const DEMO_AI_DISABLED_MESSAGE =
  "AI queries are disabled in the demo environment. For a preview with AI functionality or real, non-fake data, email zagalsky@gmail.com.";

// ─── Node icon / colour ───────────────────────────────────────────────────────

type CloudAttackPath = AttackPath & {
  cloud: "gcp" | "aws";
  region?: string;
};

type CloudFilter = "all" | "gcp" | "aws";

function nodeIcon(resourceType: string) {
  const cls = "w-4 h-4 shrink-0";
  switch (resourceType) {
    case "internet":      return <Globe       className={cls} />;
    case "firewall_rule": return <Flame       className={cls} />;
    case "vm":            return <Server      className={cls} />;
    case "cloud_run":     return <Cloud       className={cls} />;
    case "service_account": return <Key      className={cls} />;
    case "storage_bucket": return <HardDrive className={cls} />;
    case "s3_bucket":      return <HardDrive className={cls} />;
    case "ec2_instance":   return <Server      className={cls} />;
    case "rds_instance":   return <Database    className={cls} />;
    case "security_group": return <Flame       className={cls} />;
    case "iam_user":       return <User        className={cls} />;
    case "iam_role":       return <Key         className={cls} />;
    case "secret":
    case "secrets":       return <Lock        className={cls} />;
    case "project":       return <Shield      className={cls} />;
    case "user":          return <User        className={cls} />;
    case "data":          return <Database    className={cls} />;
    default:              return <Database    className={cls} />;
  }
}

const KIND_STYLES: Record<AttackNode["kind"], { border: string; bg: string; text: string; badge: string }> = {
  entry:  { border: "#ef4444", bg: "#1a0606", text: "#f87171", badge: "ENTRY" },
  pivot:  { border: "#f59e0b", bg: "#1a1206", text: "#fbbf24", badge: "PIVOT" },
  target: { border: "#a855f7", bg: "#12061a", text: "#c084fc", badge: "TARGET" },
};

function awsFindingToAttackPath(finding: AwsSecurityFinding): CloudAttackPath {
  return {
    id: `aws:${finding.id}`,
    cloud: "aws",
    region: finding.region,
    severity: finding.severity === "critical" ? "critical" : "high",
    title: `AWS: ${finding.title}`,
    description: finding.description,
    nodes: [
      {
        id: `aws-account:${finding.accountId}`,
        kind: "entry",
        resourceType: "project",
        label: finding.accountId,
        detail: "AWS account",
        projectId: finding.accountId,
        risk: "Cloud account boundary",
      },
      {
        id: `aws-resource:${finding.resourceType}:${finding.resourceName}`,
        kind: "pivot",
        resourceType: finding.resourceType,
        label: finding.resourceName,
        detail: finding.region ?? finding.resourceType.replace(/_/g, " "),
        projectId: finding.accountId,
        risk: finding.title,
      },
      {
        id: `aws-target:${finding.accountId}`,
        kind: "target",
        resourceType: "project",
        label: `Account ${finding.accountId}`,
        detail: "Potential account impact",
        projectId: finding.accountId,
        risk: finding.severity === "critical" ? "Critical AWS exposure" : "High AWS exposure",
      },
    ],
    mitigations: finding.remediationHint ? [finding.remediationHint] : ["Review and remediate this AWS finding."],
  };
}

function nodeHref(node: AttackNode): string | undefined {
  switch (node.resourceType) {
    case "storage_bucket":
    case "bucket":
      return "/dashboard/buckets";
    case "s3_bucket":
      return "/dashboard/buckets";
    case "gke_cluster":
      return "/dashboard/clusters";
    case "eks_cluster":
      return "/dashboard/aws/eks";
    case "vm":
      return "/dashboard/vms";
    case "ec2_instance":
      return "/dashboard/aws/ec2";
    case "service_account":
      return "/dashboard/service-accounts";
    case "cloud_run":
      return "/dashboard/cloud-run";
    case "cloud_sql":
      return "/dashboard/cloud-sql";
    case "bigquery":
      return "/dashboard/bigquery";
    case "pubsub":
      return "/dashboard/pubsub";
    case "secret":
    case "secrets":
      return "/dashboard/secrets";
    case "firewall":
      return "/dashboard/firewall";
    case "iam_user":
      return "/dashboard/aws/iam-users";
    case "iam_role":
      return "/dashboard/aws/iam-roles";
    case "lambda_function":
      return "/dashboard/aws/lambda";
    case "rds_instance":
      return "/dashboard/aws/rds";
    case "load_balancer":
      return "/dashboard/trace";
    case "container_image":
      return "/dashboard/container-scan";
    default:
      return undefined;
  }
}

function buildPathResources(path: CloudAttackPath): ResourceItem[] {
  return path.nodes
    .map((node) => {
      const href = nodeHref(node);
      if (!href) return null;
      return {
        name: node.label,
        projectId: node.projectId,
        type: "bucket" as const,
        href: `${href}${href.includes("?") ? "&" : "?"}search=${encodeURIComponent(node.label)}`,
      };
    })
    .filter(Boolean) as ResourceItem[];
}

const SEV_STYLES = {
  critical: { border: "#ef4444", label: "CRITICAL", color: "#ef4444", bg: "#1a0606" },
  high:     { border: "#f59e0b", label: "HIGH",     color: "#f59e0b", bg: "#1a1206" },
};

interface AiRecState {
  loading: boolean;
  text: string | null;
  error: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeEscapedHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function renderAiMarkdown(text: string, resources: ResourceItem[] = []): string {
  const html = escapeHtml(text)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
      const commandText = decodeEscapedHtml(String(code)).trim();
      const command = encodeURIComponent(commandText);
      return `<div class="group/command my-1.5 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-2 py-1.5"><pre class="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed font-mono text-slate-300">${escapeHtml(commandText)}</pre><button type="button" data-copy-command="${command}" class="shrink-0 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-violet-300 border border-violet-900/60 bg-violet-950/20 hover:text-violet-200 hover:border-violet-700">Copy</button></div>`;
    })
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-sky-300 text-xs font-mono">$1</code>')
    .replace(/^### (.+)$/gm, '<p class="text-xs font-semibold text-slate-200 uppercase tracking-wider mt-3 mb-1">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="text-sm font-semibold text-slate-200 mt-3 mb-1">$1</p>')
    .replace(/\*\*(.*?)\*\*/g, "<strong class=\"text-slate-200\">$1</strong>")
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class="space-y-1 my-1">${m}</ul>`)
    .replace(/\n(?!<)/g, "<br />");

  return linkifyText(html, resources);
}

// ─── Node card ────────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: AttackNode }) {
  const s = KIND_STYLES[node.kind];
  return (
    <div
      style={{
        border: `1px solid ${s.border}44`,
        background: s.bg,
        minWidth: 160,
        maxWidth: 200,
        padding: "10px 12px",
        position: "relative",
      }}
    >
      {/* Kind badge */}
      <div
        style={{
          position: "absolute", top: -9, left: 10,
          fontSize: 8, letterSpacing: 2, fontFamily: "monospace",
          color: s.text, background: s.bg, padding: "0 4px",
          border: `1px solid ${s.border}44`,
        }}
      >
        {s.badge}
      </div>

      <div className="flex items-center gap-2 mb-1" style={{ color: s.text }}>
        {nodeIcon(node.resourceType)}
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", wordBreak: "break-all" }}>
          {node.label.length > 28 ? node.label.slice(0, 26) + "…" : node.label}
        </span>
      </div>

      <p style={{ fontSize: 9, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.4 }}>
        {node.detail.length > 50 ? node.detail.slice(0, 48) + "…" : node.detail}
      </p>

      <p style={{ fontSize: 9, color: s.text, fontFamily: "monospace", marginTop: 4, lineHeight: 1.4, opacity: 0.8 }}>
        ⚠ {node.risk.length > 60 ? node.risk.slice(0, 58) + "…" : node.risk}
      </p>
    </div>
  );
}

// ─── Attack path card ─────────────────────────────────────────────────────────

function PathCard({ path, index }: { path: CloudAttackPath; index: number }) {
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState<AiRecState>({ loading: false, text: null, error: null });
  const [recOpen, setRecOpen] = useState(false);
  const s = SEV_STYLES[path.severity];
  const demoMode = useDemoMode();
  const resources = buildPathResources(path);

  async function askAiForPath(forceRegenerate = false) {
    if (demoMode) {
      setRecOpen(true);
      setRec({ loading: false, text: null, error: DEMO_AI_DISABLED_MESSAGE });
      return;
    }
    setRecOpen(true);
    setRec({ loading: true, text: forceRegenerate ? null : rec.text, error: null });
    try {
      const res = await fetch("/api/attack-paths/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: `${path.cloud.toUpperCase()} / ${path.severity.toUpperCase()} / ${path.title}`,
          paths: [path],
          demoCredentials: (() => {
            const browserAI = getActiveBrowserAIKey();
            return browserAI ? { aiKey: browserAI.key, aiProvider: browserAI.provider } : undefined;
          })(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setRec({ loading: false, text: data.recommendation, error: null });
    } catch (error) {
      setRec({
        loading: false,
        text: null,
        error: error instanceof Error ? error.message : "Failed to ask AI",
      });
    }
  }

  async function copySuggestedCommand(event: MouseEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-copy-command]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const command = decodeURIComponent(button.dataset.copyCommand ?? "");
    if (!command) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    const previous = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = previous ?? "Copy";
    }, 1200);
  }

  return (
    <div
      data-nav
      tabIndex={0}
      role="button"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className="rounded-xl border space-y-0 group transition-all outline-none"
      style={{ borderColor: `${s.border}33`, background: "#09090b", marginBottom: 12 }}
    >
      {/* Header */}
      <div className="w-full text-left flex items-start gap-4 p-4 transition-colors group-hover:bg-white/[0.02]">
        <div
          style={{
            fontSize: 9, letterSpacing: 2, fontFamily: "monospace",
            color: s.color, border: `1px solid ${s.border}55`,
            background: s.bg, padding: "2px 8px", whiteSpace: "nowrap", marginTop: 2,
          }}
        >
          {s.label}
        </div>
        <div
          style={{
            fontSize: 9, letterSpacing: 2, fontFamily: "monospace",
            color: path.cloud === "aws" ? "#f59e0b" : "#38bdf8",
            border: `1px solid ${path.cloud === "aws" ? "#f59e0b55" : "#38bdf855"}`,
            background: path.cloud === "aws" ? "#1a1206" : "#06121a",
            padding: "2px 8px",
            whiteSpace: "nowrap",
            marginTop: 2,
            textTransform: "uppercase",
          }}
        >
          {path.cloud}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb", fontFamily: "monospace" }}>
              {String(index + 1).padStart(2, "0")}. {path.title}
            </p>
          </div>
          {/* Mini node chain */}
          <div className="flex items-center gap-1 flex-wrap">
            {path.nodes.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1">
                <span style={{ fontSize: 9, color: KIND_STYLES[n.kind].text, fontFamily: "monospace" }}>
                  {n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label}
                </span>
                {i < path.nodes.length - 1 && (
                  <ChevronRight className="w-3 h-3" style={{ color: "#374151", flexShrink: 0 }} />
                )}
              </span>
            ))}
          </div>
        </div>
        <ChevronRight
          className="w-4 h-4 shrink-0 mt-1 transition-transform"
          style={{ color: "#4b5563", transform: open ? "rotate(90deg)" : "none" }}
        />
      </div>

      {/* Expanded content */}
      {open && (
        <div onClick={(event) => event.stopPropagation()} style={{ borderTop: `1px solid ${s.border}22`, padding: 20 }}>
          {/* Description */}
          <p style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 20 }}>
            {path.description}
          </p>

          {/* Node chain */}
          <div className="flex items-center gap-0 flex-wrap mb-6" style={{ overflowX: "auto", paddingTop: 12 }}>
            {path.nodes.map((node, i) => (
              <div key={node.id} className="flex items-center gap-0">
                <NodeCard node={node} />
                {i < path.nodes.length - 1 && (
                  <div className="flex items-center" style={{ padding: "0 4px" }}>
                    <div style={{ width: 24, height: 1, background: s.border + "66" }} />
                    <ChevronRight className="w-3 h-3" style={{ color: s.border + "99", marginLeft: -6 }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mitigations */}
          <div>
            <p style={{ fontSize: 9, letterSpacing: 3, color: "#4b5563", fontFamily: "monospace", marginBottom: 8 }}>
              // MITIGATIONS
            </p>
            <div className="space-y-2">
              {path.mitigations.map((m, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ fontSize: 10, color: "#00aa2b", fontFamily: "monospace", flexShrink: 0 }}>
                    [{String(i + 1).padStart(2, "0")}]
                  </span>
                  <p style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.6 }}>{m}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div onClick={(event) => event.stopPropagation()} className="border-t border-slate-700/50">
        <div className="px-4 py-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => rec.text ? setRecOpen((value) => !value) : void askAiForPath()}
            disabled={rec.loading || demoMode}
            className="flex items-center gap-1.5 text-xs font-medium transition-all duration-150 rounded-lg px-2.5 py-1 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            {rec.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {rec.loading ? "Asking AI..." : demoMode ? "Disabled in demo" : rec.text ? "AI Recommendation" : "Ask AI"}
          </button>
          {rec.text && (
            <div className="flex items-center gap-2">
              <CopyAiResponseButton text={rec.text} compact />
              <button
                type="button"
                onClick={() => setRecOpen((value) => !value)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                {recOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        {rec.error && (
          <div className="px-4 pb-3 flex items-center gap-2 text-xs font-mono" style={{ color: "#f87171" }}>
            <AlertCircle className="w-3 h-3 shrink-0" />
            {rec.error}
          </div>
        )}

        {demoMode && !rec.text && !rec.error && (
          <div className="px-4 pb-3 text-xs font-mono" style={{ color: "#6b7280" }}>
            {DEMO_AI_DISABLED_MESSAGE}
          </div>
        )}

        {rec.text && recOpen && (
          <div className="px-4 pb-4 border-t border-violet-900/20">
            <div
              onClick={copySuggestedCommand}
              className="mt-3 text-xs text-slate-300 leading-relaxed prose-answer"
              dangerouslySetInnerHTML={{ __html: renderAiMarkdown(rec.text, resources) }}
            />
            <button
              type="button"
              onClick={() => void askAiForPath(true)}
              disabled={rec.loading || demoMode}
              className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-violet-400 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              {demoMode ? "Disabled in demo" : "Regenerate"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttackPathsPage() {
  const [gcpPaths, setGcpPaths] = useState<CloudAttackPath[]>([]);
  const [awsPaths, setAwsPaths] = useState<CloudAttackPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "critical" | "high">("all");
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [showRemediate, setShowRemediate] = useState(false);

  const hasAwsCredentialsConfigured = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/credentials");
      if (!res.ok) return false;
      const data = await res.json();
      return (data.credentials ?? []).some((credential: { provider?: string }) => credential.provider === "aws");
    } catch {
      return false;
    }
  }, []);

  const load = useCallback(async () => {
    const startedAt = performance.now();
    setLoading(true);
    setError(null);
    console.info("[attack-paths] load started");

    const errors: string[] = [];
    const fetchedAts: string[] = [];
    let nextGcpPaths: CloudAttackPath[] = [];
    let nextAwsPaths: CloudAttackPath[] = [];

    const gcpStartedAt = performance.now();
    const gcpSnapshotPromise = fetch("/api/gcp/snapshot")
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GCP snapshot request failed: HTTP ${res.status}`);
        return res.json() as Promise<import("@/lib/gcp/types").GcpSnapshot>;
      })
      .then((snapshot) => {
        if (!snapshot) {
          console.info("[attack-paths] GCP snapshot missing", {
            durationMs: Math.round(performance.now() - gcpStartedAt),
          });
          return;
        }
        nextGcpPaths = computeAttackPaths(snapshot).map((path) => ({ ...path, cloud: "gcp" as const }));
        if (snapshot.fetchedAt) fetchedAts.push(snapshot.fetchedAt);
        console.info("[attack-paths] GCP paths computed", {
          paths: nextGcpPaths.length,
          snapshotId: snapshot.snapshotId,
          durationMs: Math.round(performance.now() - gcpStartedAt),
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        console.warn("[attack-paths] GCP analysis failed", { error: message });
      });

    const awsStartedAt = performance.now();
    const awsSnapshotPromise = hasAwsCredentialsConfigured()
      .then(async (hasAwsCredentials) => {
        if (!hasAwsCredentials) {
          console.info("[attack-paths] AWS skipped: no credentials configured", {
            durationMs: Math.round(performance.now() - awsStartedAt),
          });
          return null;
        }
        const res = await fetch("/api/aws/snapshot");
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`AWS snapshot request failed: HTTP ${res.status}`);
        return res.json() as Promise<AwsSnapshot>;
      })
      .then((snapshot) => {
        if (!snapshot) return;
        nextAwsPaths = computeAwsFindings(snapshot)
          .filter((finding) => finding.severity === "critical" || finding.severity === "high")
          .map(awsFindingToAttackPath);
        if (snapshot.fetchedAt) fetchedAts.push(snapshot.fetchedAt);
        console.info("[attack-paths] AWS paths computed", {
          paths: nextAwsPaths.length,
          snapshotId: snapshot.snapshotId,
          durationMs: Math.round(performance.now() - awsStartedAt),
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        console.warn("[attack-paths] AWS analysis failed", { error: message });
      });

    await Promise.all([gcpSnapshotPromise, awsSnapshotPromise]);

    setGcpPaths(nextGcpPaths);
    setAwsPaths(nextAwsPaths);
    setFetchedAt(fetchedAts.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null);
    setError(errors.length > 0 ? errors.join("; ") : null);
    setLoading(false);
    console.info("[attack-paths] load completed", {
      gcpPaths: nextGcpPaths.length,
      awsPaths: nextAwsPaths.length,
      errors,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }, [hasAwsCredentialsConfigured]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleLoad() {
    void load();
  }

  function handleRefreshClick() {
    if (loading) return;
    void load();
  }

  function emptyMessage() {
    if (error) {
      return "Attack path analysis could not load all cloud snapshots. Check the error above, then scan again.";
    }
    if (cloudFilter === "aws") return "No AWS attack paths found in the current AWS snapshot.";
    if (cloudFilter === "gcp") return "No GCP attack paths found in the current GCP snapshot.";
    return "No attack paths found in the current cloud snapshots.";
  }

  const paths = [...gcpPaths, ...awsPaths];
  const cloudCounts = {
    all: paths.length,
    gcp: gcpPaths.length,
    aws: awsPaths.length,
  };
  const cloudFiltered = cloudFilter === "all" ? paths : paths.filter((path) => path.cloud === cloudFilter);
  const visible = cloudFiltered.filter((p) => filter === "all" || p.severity === filter);
  const critCount = cloudFiltered.filter((p) => p.severity === "critical").length;
  const highCount = cloudFiltered.filter((p) => p.severity === "high").length;
  const gcpRemediablePaths = visible.filter((path) => path.cloud === "gcp");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase" style={{ color: "var(--green)" }}>
            // Attack Path Analysis
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
            Chains of misconfigurations that combine into exploitable paths
            {fetchedAt && <span style={{ color: "var(--border-dim)" }}> · snapshot {new Date(fetchedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {gcpRemediablePaths.length > 0 && (
            <button
              onClick={() => setShowRemediate(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
              style={{ border: "1px solid var(--green)", color: "var(--green)", background: "rgba(0,170,43,0.06)" }}
            >
              <GitPullRequest className="w-3 h-3" />
              Fix GCP with GitHub PR
            </button>
          )}
          <ScanCloudButton onScanComplete={handleLoad} variant="terminal" />
          <button
            onClick={handleRefreshClick}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
            style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm font-mono" style={{ border: "1px solid var(--red)", color: "var(--red)", background: "#1a0606" }}>
          !! {error}
        </div>
      )}

      {!loading && paths.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Paths", value: cloudFiltered.length, color: "var(--green)" },
              { label: "Critical", value: critCount, color: "#ef4444" },
              { label: "High", value: highCount, color: "#f59e0b" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)", padding: "12px 16px" }}>
                <p style={{ fontSize: 9, letterSpacing: 3, color: "var(--border-dim)", fontFamily: "monospace" }}>{label.toUpperCase()}</p>
                <p style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.2 }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Cloud filter */}
          <div className="flex gap-1 flex-wrap">
            {([
              { key: "all", label: "ALL CLOUDS", count: cloudCounts.all },
              { key: "gcp", label: "GCP", count: cloudCounts.gcp },
              { key: "aws", label: "AWS", count: cloudCounts.aws },
            ] as const).map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setCloudFilter(item.key);
                  setFilter("all");
                }}
                style={{
                  fontFamily: "monospace", fontSize: 10, letterSpacing: 2, padding: "4px 14px",
                  border: cloudFilter === item.key ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                  color: cloudFilter === item.key ? "var(--green)" : "var(--text-muted)",
                  background: "transparent", textTransform: "uppercase",
                }}
              >
                {item.label} ({item.count})
              </button>
            ))}
          </div>

          {/* Severity filter */}
          <div className="flex gap-1">
            {(["all", "critical", "high"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontFamily: "monospace", fontSize: 10, letterSpacing: 2, padding: "4px 14px",
                  border: filter === f ? "1px solid var(--green)" : "1px solid var(--border-dim)",
                  color: filter === f ? "var(--green)" : "var(--text-muted)",
                  background: "transparent", textTransform: "uppercase",
                }}
              >
                {f === "all" ? `ALL (${cloudFiltered.length})` : f === "critical" ? `CRITICAL (${critCount})` : `HIGH (${highCount})`}
              </button>
            ))}
          </div>

          {/* Paths */}
          {visible.length > 0 ? (
            <div>
              {visible.map((path, i) => <PathCard key={path.id} path={path} index={i} />)}
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center py-16 gap-3"
              style={{ border: "1px solid var(--border-dim)" }}
            >
              <AlertTriangle className="w-7 h-7" style={{ color: "var(--green)" }} />
              <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
                No attack paths match the selected filters.
              </p>
            </div>
          )}
        </>
      )}

      {!loading && paths.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center py-20 gap-4"
          style={{ border: "1px solid var(--border-dim)" }}
        >
          <AlertTriangle className="w-8 h-8" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            {emptyMessage()}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ border: "1px solid var(--border-dim)" }}>
          <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "var(--green)" }} />
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>
            Loading cached snapshots and computing attack paths…
          </p>
        </div>
      )}

      {showRemediate && (
        <RemediateModal targets={gcpRemediablePaths.map(remediationTargetFromAttackPath)} onClose={() => setShowRemediate(false)} />
      )}
    </div>
  );
}
