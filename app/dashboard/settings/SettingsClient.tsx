"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Trash2, Check, Loader2, AlertCircle, CheckCircle2, Star, Plus, X, ShieldCheck, Bell, Send, Wifi, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIProvider, AIKeyRecord } from "@/lib/ai/client";
import {
  getDemoCredentials,
  setDemoGcpCredentials,
  setDemoAwsCredentials,
  clearDemoCredentials,
  type DemoCredentials,
} from "@/lib/demo-credentials";
import { getBrowserAIKeys, setBrowserAIKey, removeBrowserAIKey, getActiveBrowserProvider, setActiveBrowserProvider, type BrowserAIKeys } from "@/lib/ai/browser-ai-keys";
import SelfManagedClusterCard from "@/components/SelfManagedClusterCard";

interface CloudCredRecord {
  provider: string;
  createdAt: string;
  updatedAt: string;
}

interface GithubRepoRecord {
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
}

interface GithubRemediationDefaultsRecord {
  repoFullName: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

type TraceSourceMode = "polling" | "streaming";
type GcpComputeTraceSource = "cloud_logging" | "pubsub";
type GcpGkeTraceSource = GcpComputeTraceSource | "ebpf_agent";
type TraceSetupState = "not_configured" | "terraform_generated" | "resources_applied" | "receiving_events";
type TunnelProvider = "cloudflared" | "ngrok";
type TunnelState = "idle" | "starting" | "running" | "error";

function getPublicHttpsPushEndpoint(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return "";
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return "";
    return `${url.origin}/api/ingest/gcp/pubsub`;
  } catch {
    return "";
  }
}

function validateStreamingPushEndpoint(pushEndpoint: string): string | null {
  const value = pushEndpoint.trim();
  if (!value) return "Set a public HTTPS Watchmen URL for Pub/Sub push delivery.";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a valid absolute push endpoint URL.";
  }

  if (url.protocol !== "https:") return "Pub/Sub push delivery requires HTTPS.";

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return "Pub/Sub cannot push to localhost. Use a deployed Watchmen URL.";
  }
  if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) {
    return "Pub/Sub cannot push to a private-network URL. Use a public Watchmen URL.";
  }

  return null;
}

interface GcpTraceSourceConfig {
  cloud: "gcp";
  mode: TraceSourceMode;
  computeSource: GcpComputeTraceSource;
  gkeSource: GcpGkeTraceSource;
  projectId: string;
  region: string;
  namePrefix: string;
  pushEndpoint: string;
  pushAudience: string;
  setupState: TraceSetupState;
  lastCheckedAt: string | null;
  lastCheckMessage: string;
}

interface GcpAgentClusterStatus {
  clusterName: string;
  projectId: string;
  location: string;
  locationType: "regional" | "zonal";
  snapshotNodeCount: number;
  nodeCount: number;
  healthyCount: number;
  installed: boolean;
  healthy: boolean;
  lastSeenAt: string | null;
  manifestUrl: string;
  deployCommand: string;
}

interface GeneratedFile {
  name: string;
  content: string;
  language: string;
}

interface GcpTraceSourceBundle {
  files: GeneratedFile[];
  steps: string[];
  notes: string[];
}

interface LocalTunnelStatus {
  state: TunnelState;
  provider: TunnelProvider | null;
  publicUrl: string;
  pushEndpoint: string;
  port: number;
  message: string;
  availableProviders: TunnelProvider[];
  logs: string[];
}

interface ProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  accent: string;
  logo: string;
  models: string;
  placeholder: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "google",
    name: "Google Gemini",
    description: "Powers natural language queries and security recommendations",
    color: "text-blue-400",
    bg: "bg-blue-500/8",
    border: "border-blue-500/25",
    accent: "bg-blue-500",
    logo: "G",
    models: "gemini-2.5-flash",
    placeholder: "AIza...",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o-mini for fast, cost-effective AI responses",
    color: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/25",
    accent: "bg-emerald-500",
    logo: "⊕",
    models: "gpt-4o-mini",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet for nuanced security analysis",
    color: "text-orange-400",
    bg: "bg-orange-500/8",
    border: "border-orange-500/25",
    accent: "bg-orange-500",
    logo: "◬",
    models: "claude-sonnet-4-6",
    placeholder: "sk-ant-...",
  },
];

interface ErrorEntry {
  id: string;
  timestamp: string;
  provider: string;
  message: string;
}

interface LocalKubernetesConfigRecord {
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
  hasKubeconfig?: boolean;
  kubeconfigFilename?: string;
}

interface LocalKubernetesStatusRecord {
  ok: boolean;
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
  clusterName: string;
  serverUrl: string;
  kubernetesVersion: string;
  nodeCount: number;
  namespaceCount: number;
  hasKubeconfig?: boolean;
  kubeconfigFilename?: string;
  distribution?: string;
  contexts?: { name: string; cluster: string; user: string; namespace?: string }[];
  error?: string;
  code?: string;
}

export default function SettingsClient({ isDemoUser }: { isDemoUser: boolean }) {
  const [keys, setKeys] = useState<AIKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState<Record<AIProvider, string>>({ google: "", openai: "", anthropic: "" });
  const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [saving, setSaving] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [deleting, setDeleting] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [activating, setActivating] = useState<AIProvider | null>(null);
  const [errorLog, setErrorLog] = useState<ErrorEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"ai" | "integrations" | "alerts" | "diagnostics">("ai");

  // Server-backed cloud credentials state (non-demo users)
  const [cloudCreds, setCloudCreds] = useState<CloudCredRecord[]>([]);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [gcpKeyInput, setGcpKeyInput] = useState("");
  const [awsAuthMode, setAwsAuthMode] = useState<"role" | "keys">("keys");
  const [awsInputs, setAwsInputs] = useState({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
  const [awsRoleInputs, setAwsRoleInputs] = useState({ roleArn: "", externalId: "", region: "us-east-1" });
  const [showAwsSecret, setShowAwsSecret] = useState(false);
  const [cloudSaving, setCloudSaving] = useState<Record<string, boolean>>({ gcp: false, aws: false, ghcr: false, dockerhub: false, github: false });
  const [cloudDeleting, setCloudDeleting] = useState<Record<string, boolean>>({ gcp: false, aws: false, ghcr: false, dockerhub: false, github: false });
  const [cloudErrors, setCloudErrors] = useState<Record<string, string>>({ gcp: "", aws: "", ghcr: "", dockerhub: "", github: "" });
  const [githubRemediationDefaults, setGithubRemediationDefaults] = useState<GithubRemediationDefaultsRecord | null>(null);
  const [githubRemediationRepos, setGithubRemediationRepos] = useState<GithubRepoRecord[]>([]);
  const [githubRemediationBranches, setGithubRemediationBranches] = useState<string[]>([]);
  const [githubRemediationRepoSearch, setGithubRemediationRepoSearch] = useState("");
  const [githubRemediationRepoFullName, setGithubRemediationRepoFullName] = useState("");
  const [githubRemediationBranch, setGithubRemediationBranch] = useState("");
  const [githubRemediationLoading, setGithubRemediationLoading] = useState(false);
  const [githubRemediationBranchesLoading, setGithubRemediationBranchesLoading] = useState(false);
  const [githubRemediationSaving, setGithubRemediationSaving] = useState(false);
  const [githubRemediationError, setGithubRemediationError] = useState<string | null>(null);

  const [ghcrToken, setGhcrToken] = useState("");
  const [showGhcrToken, setShowGhcrToken] = useState(false);

  const [dockerHubInputs, setDockerHubInputs] = useState({ username: "", token: "" });
  const [showDockerHubToken, setShowDockerHubToken] = useState(false);

  const [githubToken, setGithubToken] = useState("");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [gcpTraceSource, setGcpTraceSource] = useState<GcpTraceSourceConfig | null>(null);
  const [gcpTraceBundle, setGcpTraceBundle] = useState<GcpTraceSourceBundle | null>(null);
  const [gcpTraceSaving, setGcpTraceSaving] = useState(false);
  const [gcpTraceChecking, setGcpTraceChecking] = useState(false);
  const [gcpTraceLoading, setGcpTraceLoading] = useState(true);
  const [gcpTraceError, setGcpTraceError] = useState<string | null>(null);
  const [gcpAgentClusters, setGcpAgentClusters] = useState<GcpAgentClusterStatus[]>([]);
  const [gcpAgentLoading, setGcpAgentLoading] = useState(false);
  const [copiedAgentCommand, setCopiedAgentCommand] = useState<string | null>(null);
  const [copiedFileName, setCopiedFileName] = useState<string | null>(null);
  const [localTunnel, setLocalTunnel] = useState<LocalTunnelStatus | null>(null);
  const [localTunnelLoading, setLocalTunnelLoading] = useState(false);
  const [localTunnelAction, setLocalTunnelAction] = useState<"start" | "stop" | null>(null);
  const [localKubernetesConfig, setLocalKubernetesConfig] = useState<LocalKubernetesConfigRecord>({
    enabled: false,
    kubeconfigPath: "~/.kube/config",
    context: "",
    namespace: "watchmen",
  });
  const [localKubernetesStatus, setLocalKubernetesStatus] = useState<LocalKubernetesStatusRecord | null>(null);
  const [localKubernetesLoading, setLocalKubernetesLoading] = useState(false);
  const [localKubernetesTesting, setLocalKubernetesTesting] = useState(false);
  const [localKubernetesSaving, setLocalKubernetesSaving] = useState(false);
  const [localKubernetesError, setLocalKubernetesError] = useState<string | null>(null);
  const [kubeconfigPaste, setKubeconfigPaste] = useState("");
  const [kubeconfigUploading, setKubeconfigUploading] = useState(false);
  const [kubeconfigDeleting, setKubeconfigDeleting] = useState(false);
  const [kubeconfigFileName, setKubeconfigFileName] = useState<string | null>(null);
  const [showKubeconfigHints, setShowKubeconfigHints] = useState(false);
  const [kubeconfigTab, setKubeconfigTab] = useState<"upload" | "paste">("upload");
  const [kubeDragOver, setKubeDragOver] = useState(false);
  const [showAdvancedKube, setShowAdvancedKube] = useState(false);
  const [kubeTestPhase, setKubeTestPhase] = useState<"idle" | "testing" | "success" | "error">("idle");
  // Multi-cluster
  const [clusters, setClusters] = useState<Array<{ id: string; name: string; enabled: boolean; kubeconfigPath: string; context: string; namespace: string; kubeconfigFilename?: string; hasKubeconfig?: boolean }>>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");
  const [creatingCluster, setCreatingCluster] = useState(false);
  const [clustersError, setClustersError] = useState<string | null>(null);
  const [bulkPaste, setBulkPaste] = useState("");
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);

  // Browser-only AI keys
  const [browserKeys, setBrowserKeys] = useState<BrowserAIKeys>({});
  const [saveToBrowser, setSaveToBrowser] = useState<Record<AIProvider, boolean>>(() => ({
    google: isDemoUser,
    openai: isDemoUser,
    anthropic: isDemoUser,
  }));

  // Browser-only demo credentials state
  const [demoCreds, setDemoCreds] = useState<DemoCredentials>({});
  const [demoGcpInput, setDemoGcpInput] = useState("");
  const [demoAwsInputs, setDemoAwsInputs] = useState({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
  const [showDemoAwsSecret, setShowDemoAwsSecret] = useState(false);
  const [demoSaved, setDemoSaved] = useState<Record<string, boolean>>({ gcp: false, aws: false });

  // Alert notifications state
  const [alertWebhook, setAlertWebhook] = useState("");
  const [alertSlackToken, setAlertSlackToken] = useState("");
  const [alertSlackChannel, setAlertSlackChannel] = useState("");
  const [alertOnCritical, setAlertOnCritical] = useState(true);
  const [alertOnHigh, setAlertOnHigh] = useState(false);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [alertSaved, setAlertSaved] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertTestResult, setAlertTestResult] = useState<"ok" | "fail" | null>(null);
  const [showSlackToken, setShowSlackToken] = useState(false);
  const [simSelected, setSimSelected] = useState<string[]>([]);
  const [simSending, setSimSending] = useState(false);
  const [simResult, setSimResult] = useState<"ok" | "fail" | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => { })
      .finally(() => setLoading(false));

    setBrowserKeys(getBrowserAIKeys());
  }, []);

  useEffect(() => {
    if (isDemoUser) {
      setDemoCreds(getDemoCredentials());
      setCloudLoading(false);
      setGcpTraceLoading(false);
    } else {
      fetch("/api/settings/credentials")
        .then((r) => r.json())
        .then((d) => setCloudCreds(d.credentials ?? []))
        .catch(() => { })
        .finally(() => setCloudLoading(false));

      fetch("/api/settings/trace-source/gcp")
        .then((r) => r.json())
        .then((d) => setGcpTraceSource(d.config ? {
          ...d.config,
          computeSource: d.config.computeSource ?? "cloud_logging",
          gkeSource: d.config.gkeSource ?? "cloud_logging",
        } : null))
        .catch(() => setGcpTraceError("Failed to load GCP trace source settings."))
        .finally(() => setGcpTraceLoading(false));

      refreshGcpAgentStatus();

      fetch("/api/settings/trace-source/gcp/tunnel")
        .then((r) => r.json())
        .then((d) => setLocalTunnel(d.status ?? null))
        .catch(() => {})
        .finally(() => setLocalTunnelLoading(false));

      setLocalKubernetesLoading(true);
      fetch("/api/kubernetes/local/status")
        .then((r) => r.json())
        .then((d) => {
          if (d.config) setLocalKubernetesConfig((prev) => ({ ...prev, ...d.config, hasKubeconfig: d.hasKubeconfig ?? d.status?.hasKubeconfig, kubeconfigFilename: d.kubeconfigFilename ?? d.status?.kubeconfigFilename }));
          if (d.status) setLocalKubernetesStatus(d.status);
          if (d.hasKubeconfig !== undefined) setKubeconfigFileName(d.kubeconfigFilename ?? d.status?.kubeconfigFilename ?? null);
          else if (d.status?.kubeconfigFilename) setKubeconfigFileName(d.status.kubeconfigFilename);
        })
        .catch(() => setLocalKubernetesError("Failed to load local Kubernetes settings."))
        .finally(() => setLocalKubernetesLoading(false));

      // Multi-cluster list (migrates legacy single if needed)
      setClustersLoading(true);
      setClustersError(null);
      fetch("/api/kubernetes/clusters", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.clusters)) setClusters(d.clusters);
          else setClusters([]);
          if (d.error) setClustersError(d.error);
        })
        .catch(() => setClustersError("Failed to load clusters."))
        .finally(() => setClustersLoading(false));
    }
  }, [isDemoUser]);

  useEffect(() => {
    if (isDemoUser) return;
    setGithubRemediationLoading(true);
    fetch("/api/settings/github-remediation")
      .then((r) => r.json())
      .then((d) => {
        setGithubRemediationDefaults(d.defaults ?? null);
        if (d.defaults?.repoFullName) {
          setGithubRemediationRepoFullName(d.defaults.repoFullName);
          setGithubRemediationBranch(d.defaults.defaultBranch ?? "");
        }
      })
      .catch(() => setGithubRemediationError("Failed to load GitHub remediation defaults."))
      .finally(() => setGithubRemediationLoading(false));
  }, [isDemoUser]);

  useEffect(() => {
    if (isDemoUser) return;
    const hasGithubToken = cloudCreds.some((c) => c.provider === "github");
    if (!hasGithubToken) {
      setGithubRemediationRepos([]);
      setGithubRemediationLoading(false);
      return;
    }

    let cancelled = false;
    setGithubRemediationLoading(true);
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.repos)) {
          setGithubRemediationRepos(d.repos);
          if (!githubRemediationRepoFullName && githubRemediationDefaults?.repoFullName) {
            setGithubRemediationRepoFullName(githubRemediationDefaults.repoFullName);
            setGithubRemediationBranch(githubRemediationDefaults.defaultBranch ?? "");
          }
        } else {
          setGithubRemediationRepos([]);
        }
      })
      .catch(() => {
        if (!cancelled) setGithubRemediationError("Failed to load GitHub repositories.");
      })
      .finally(() => {
        if (!cancelled) setGithubRemediationLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemoUser, cloudCreds, githubRemediationDefaults?.repoFullName, githubRemediationRepoFullName]);

  useEffect(() => {
    if (!githubRemediationRepoFullName) {
      setGithubRemediationBranches([]);
      setGithubRemediationBranch("");
      return;
    }

    const repo = githubRemediationRepos.find((item) => item.full_name === githubRemediationRepoFullName);
    if (!repo) return;

    let cancelled = false;
    setGithubRemediationBranchesLoading(true);
    setGithubRemediationError(null);
    fetch(`/api/github/repos/${encodeURIComponent(repo.full_name.split("/")[0])}/${encodeURIComponent(repo.full_name.split("/")[1])}/branches`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const branches = Array.isArray(d.branches) ? d.branches : [];
        setGithubRemediationBranches(branches);
        setGithubRemediationBranch((current) => {
          if (current && branches.includes(current)) return current;
          if (githubRemediationDefaults?.repoFullName === repo.full_name && githubRemediationDefaults.defaultBranch) {
            return githubRemediationDefaults.defaultBranch;
          }
          return repo.default_branch || branches[0] || "";
        });
      })
      .catch(() => {
        if (!cancelled) setGithubRemediationError("Failed to load branches for the selected repository.");
      })
      .finally(() => {
        if (!cancelled) setGithubRemediationBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [githubRemediationRepoFullName, githubRemediationRepos, githubRemediationDefaults]);

  // Load alert rules
  useEffect(() => {
    if (isDemoUser) return;
    fetch("/api/alerts/rules")
      .then((r) => r.json())
      .then((d) => {
        if (d.webhookUrl !== undefined) {
          setAlertWebhook(d.webhookUrl);
          setAlertOnCritical(d.onNewCritical);
          setAlertOnHigh(d.onNewHigh);
          setAlertSlackToken(d.slackBotToken ?? "");
          setAlertSlackChannel(d.slackChannelId ?? "");
        }
      })
      .catch(() => { });
  }, [isDemoUser]);

  async function saveAlertRules() {
    setAlertSaving(true);
    setAlertError(null);
    setAlertSaved(false);
    try {
      const res = await fetch("/api/alerts/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: alertWebhook, onNewCritical: alertOnCritical, onNewHigh: alertOnHigh, slackBotToken: alertSlackToken, slackChannelId: alertSlackChannel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setAlertSaved(true);
      setTimeout(() => setAlertSaved(false), 2000);
    } catch (e) {
      setAlertError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAlertSaving(false);
    }
  }

  async function testWebhook() {
    setAlertTesting(true);
    setAlertTestResult(null);
    setAlertError(null);
    try {
      const res = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: alertWebhook, slackBotToken: alertSlackToken, slackChannelId: alertSlackChannel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setAlertTestResult("ok");
      setTimeout(() => setAlertTestResult(null), 3000);
    } catch (e) {
      setAlertTestResult("fail");
      setAlertError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setAlertTesting(false);
    }
  }

  async function sendSimulation() {
    setSimSending(true);
    setSimResult(null);
    setSimError(null);
    try {
      const res = await fetch("/api/alerts/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: simSelected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Simulation failed");
      setSimResult("ok");
      setTimeout(() => setSimResult(null), 3000);
    } catch (e) {
      setSimResult("fail");
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimSending(false);
    }
  }

  function addError(provider: string, message: string) {
    setErrorLog((prev) => [
      { id: crypto.randomUUID(), timestamp: new Date().toISOString(), provider, message },
      ...prev.slice(0, 19),
    ]);
  }

  async function saveGcpTraceSource() {
    if (!gcpTraceSource) return;
    if (gcpTraceSource.mode === "streaming") {
      const pushEndpointError = validateStreamingPushEndpoint(gcpTraceSource.pushEndpoint);
      if (pushEndpointError) {
        setGcpTraceError(pushEndpointError);
        return;
      }
    }
    setGcpTraceSaving(true);
    setGcpTraceError(null);
    try {
      const res = await fetch("/api/settings/trace-source/gcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gcpTraceSource),
      });
      const data = await res.json();
      if (!res.ok) {
        setGcpTraceError(data.error ?? "Failed to save trace source settings.");
        return;
      }
      setGcpTraceSource(data.config ?? gcpTraceSource);
      setGcpTraceBundle(data.bundle ?? null);
      if ((data.config ?? gcpTraceSource)?.gkeSource === "ebpf_agent") {
        refreshGcpAgentStatus();
      }
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to save trace source settings.");
    } finally {
      setGcpTraceSaving(false);
    }
  }

  async function testLocalKubernetes(save = false) {
    if (save) {
      setLocalKubernetesSaving(true);
    } else {
      setLocalKubernetesTesting(true);
    }
    setKubeTestPhase("testing");
    setLocalKubernetesError(null);
    try {
      const res = await fetch("/api/kubernetes/local/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...localKubernetesConfig, save }),
      });
      const data = await res.json();
      if (data.config) setLocalKubernetesConfig((prev) => ({ ...prev, ...data.config, hasKubeconfig: data.hasKubeconfig ?? data.status?.hasKubeconfig ?? prev.hasKubeconfig, kubeconfigFilename: data.kubeconfigFilename ?? data.status?.kubeconfigFilename ?? prev.kubeconfigFilename }));
      if (data.status) setLocalKubernetesStatus(data.status);
      if (data.kubeconfigFilename) setKubeconfigFileName(data.kubeconfigFilename);
      if (!res.ok) {
        setLocalKubernetesError(data.status?.error ?? data.error ?? "Local Kubernetes connection failed.");
        setKubeTestPhase("error");
      } else if (data.status?.ok) {
        setKubeTestPhase("success");
        if (save) {
          // auto-enable on successful save for better UX
          setLocalKubernetesConfig((prev) => ({ ...prev, enabled: true }));
        }
      } else {
        setKubeTestPhase("idle");
      }
    } catch (e) {
      setLocalKubernetesError(e instanceof Error ? e.message : "Local Kubernetes connection failed.");
      setKubeTestPhase("error");
    } finally {
      setLocalKubernetesTesting(false);
      setLocalKubernetesSaving(false);
    }
  }

  async function uploadKubeconfigFile(file: File) {
    if (file.size > 500 * 1024) {
      setLocalKubernetesError("File too large — max 500 KB.");
      return;
    }
    setKubeconfigUploading(true);
    setLocalKubernetesError(null);
    setKubeTestPhase("idle");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/kubernetes/local/kubeconfig", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setLocalKubernetesError(data.error ?? "Failed to upload kubeconfig.");
        return;
      }
      if (data.context) setLocalKubernetesConfig((prev) => ({ ...prev, context: data.context }));
      if (data.status) setLocalKubernetesStatus(data.status);
      setKubeconfigFileName(data.kubeconfigFilename ?? file.name);
      setLocalKubernetesConfig((prev) => ({ ...prev, hasKubeconfig: true, kubeconfigFilename: data.kubeconfigFilename ?? file.name }));
    } catch (e) {
      setLocalKubernetesError(e instanceof Error ? e.message : "Failed to upload kubeconfig.");
    } finally {
      setKubeconfigUploading(false);
    }
  }

  async function uploadKubeconfigPaste() {
    const trimmed = kubeconfigPaste.trim();
    if (!trimmed) {
      setLocalKubernetesError("Paste a kubeconfig YAML first.");
      return;
    }
    if (trimmed.length > 500 * 1024) {
      setLocalKubernetesError("Pasted content too large — max 500 KB.");
      return;
    }
    if (!trimmed.includes("apiVersion:") || !trimmed.includes("clusters:") || !trimmed.includes("contexts:")) {
      setLocalKubernetesError("Paste does not look like a kubeconfig — expected apiVersion, clusters, contexts.");
      return;
    }
    setKubeconfigUploading(true);
    setLocalKubernetesError(null);
    setKubeTestPhase("idle");
    try {
      const res = await fetch("/api/kubernetes/local/kubeconfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kubeconfig: trimmed, filename: "pasted-kubeconfig.yaml" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLocalKubernetesError(data.error ?? "Failed to save kubeconfig.");
        return;
      }
      if (data.context) setLocalKubernetesConfig((prev) => ({ ...prev, context: data.context }));
      if (data.status) setLocalKubernetesStatus(data.status);
      setKubeconfigFileName(data.kubeconfigFilename ?? "pasted-kubeconfig.yaml");
      setLocalKubernetesConfig((prev) => ({ ...prev, hasKubeconfig: true, kubeconfigFilename: data.kubeconfigFilename ?? "pasted-kubeconfig.yaml" }));
      setKubeconfigPaste("");
    } catch (e) {
      setLocalKubernetesError(e instanceof Error ? e.message : "Failed to save kubeconfig.");
    } finally {
      setKubeconfigUploading(false);
    }
  }

  async function deleteKubeconfig() {
    setKubeconfigDeleting(true);
    setLocalKubernetesError(null);
    try {
      const res = await fetch("/api/kubernetes/local/kubeconfig", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setLocalKubernetesError(data.error ?? "Failed to remove kubeconfig.");
        return;
      }
      setKubeconfigFileName(null);
      setLocalKubernetesConfig((prev) => ({ ...prev, hasKubeconfig: false, kubeconfigFilename: undefined }));
      if (data.status) setLocalKubernetesStatus(data.status);
    } catch (e) {
      setLocalKubernetesError(e instanceof Error ? e.message : "Failed to remove kubeconfig.");
    } finally {
      setKubeconfigDeleting(false);
    }
  }

  async function refreshClusters() {
    setClustersLoading(true);
    setClustersError(null);
    try {
      const res = await fetch("/api/kubernetes/clusters", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to load clusters");
      setClusters(Array.isArray(d.clusters) ? d.clusters : []);
    } catch (e) {
      setClustersError(e instanceof Error ? e.message : "Failed to load clusters");
    } finally {
      setClustersLoading(false);
    }
  }

  async function createCluster() {
    const name = newClusterName.trim();
    if (!name) {
      setClustersError("Enter a cluster name (e.g. prod-k3s).");
      return;
    }
    if (name.length < 2) {
      setClustersError("Name must be at least 2 characters.");
      return;
    }
    setCreatingCluster(true);
    setClustersError(null);
    try {
      const res = await fetch("/api/kubernetes/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to create cluster");
      setNewClusterName("");
      await refreshClusters();
    } catch (e) {
      setClustersError(e instanceof Error ? e.message : "Failed to create cluster");
    } finally {
      setCreatingCluster(false);
    }
  }

  async function createClustersFromPastedKubeconfig(text: string, filename = "pasted-kubeconfig.yaml") {
    const trimmed = text.trim();
    if (!trimmed) {
      setClustersError("Paste a kubeconfig YAML first.");
      return;
    }
    if (trimmed.length > 500 * 1024) {
      setClustersError("Pasted content too large — max 500 KB.");
      return;
    }
    if (!trimmed.includes("apiVersion:") || !trimmed.includes("clusters:") || !trimmed.includes("contexts:")) {
      setClustersError("Paste does not look like a kubeconfig — expected apiVersion, clusters, contexts.");
      return;
    }
    const contextsBlockMatch = trimmed.match(/contexts:\s*\n([\s\S]*?)(?=\n[a-zA-Z0-9_-]+\s*:|$)/);
    const contextsBlock = contextsBlockMatch ? contextsBlockMatch[1] : trimmed;
    const contextEntries: Array<{ name: string; cluster: string; namespace?: string }> = [];
    const contextRegex = /-\s*name:\s*([^\s\n]+)\s*\n[\s\S]*?cluster:\s*([^\s\n]+)(?:\s*\n[\s\S]*?namespace:\s*([^\s\n]+))?/g;
    const searchText = contextsBlock.includes("cluster:") ? contextsBlock : trimmed;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = contextRegex.exec(searchText)) !== null) {
      const n = m[1].replace(/["']/g, "").trim();
      const c = m[2].replace(/["']/g, "").trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        contextEntries.push({ name: n, cluster: c, namespace: m[3]?.replace(/["']/g, "").trim() });
      }
      if (contextEntries.length >= 20) break;
    }
    const isMerged = contextEntries.length > 1;
    const sanitize = (s: string) => s.replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || s.slice(0, 64);
    setCreatingCluster(true);
    setClustersError(null);
    try {
      if (isMerged) {
        let created = 0;
        let lastError: string | null = null;
        const unreachableNames: string[] = [];
        const otherErrors: string[] = [];
        for (const ctx of contextEntries) {
          const base = ctx.cluster || ctx.name;
          let derived = sanitize(base) || sanitize(ctx.name) || `cluster-${Date.now().toString(36)}`;
          const prefix = newClusterName.trim();
          let nameToUse = prefix ? `${prefix}-${derived}`.slice(0, 64) : derived;
          const existingNames = new Set(clusters.map((c) => c.name));
          // also account for names created in this loop
          let suffix = 1;
          let candidate = nameToUse;
          while (existingNames.has(candidate) && suffix < 20) {
            suffix += 1;
            candidate = `${nameToUse}-${suffix}`.slice(0, 64);
          }
          nameToUse = candidate;
          existingNames.add(nameToUse);
          const res = await fetch("/api/kubernetes/clusters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: nameToUse, enabled: true, kubeconfigContent: trimmed, kubeconfigFilename: filename, context: ctx.name, namespace: ctx.namespace ?? "watchmen" }),
          });
          const d = await res.json().catch(() => ({} as { error?: string; code?: string }));
          if (!res.ok) {
            const errMsg = d.error ?? `Failed for ${nameToUse} (${res.status})`;
            const isUnreachable = (d as { code?: string }).code === "unreachable" || /unreachable/i.test(errMsg);
            if (isUnreachable) unreachableNames.push(nameToUse);
            else otherErrors.push(errMsg);
            lastError = errMsg;
          } else {
            created += 1;
          }
        }
        if (created === 0) {
          if (unreachableNames.length === contextEntries.length) {
            setNewClusterName("");
            setBulkPaste("");
            setBulkPasteOpen(false);
            await refreshClusters();
            return;
          }
          throw new Error(lastError ?? "Failed to create clusters from merged kubeconfig");
        }
        if (created < contextEntries.length) {
          if (otherErrors.length) {
            setClustersError(`Added ${created}/${contextEntries.length} clusters. Errors: ${otherErrors.slice(0, 3).join(" | ")}`);
          } else {
            setClustersError(null);
          }
        } else {
          setClustersError(null);
        }
        setNewClusterName("");
        setBulkPaste("");
        setBulkPasteOpen(false);
        await refreshClusters();
      } else {
        let derived = "";
        const clusterMatch = trimmed.match(/clusters:\s*\n\s*-\s*name:\s*([^\s\n]+)/);
        if (clusterMatch) derived = clusterMatch[1].replace(/["']/g, "");
        if (!derived) {
          const ctxCluster = trimmed.match(/contexts:\s*\n[\s\S]*?cluster:\s*([^\s\n]+)/);
          if (ctxCluster) derived = ctxCluster[1].replace(/["']/g, "");
        }
        if (!derived) derived = filename.replace(/\.(yaml|yml|kubeconfig|txt)$/i, "").replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64) || `cluster-${Date.now().toString(36)}`;
        derived = derived.trim().slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || derived;
        if (!derived) derived = `cluster-${Date.now().toString(36)}`;
        const nameToUse = newClusterName.trim() || derived;
        const res = await fetch("/api/kubernetes/clusters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameToUse, enabled: true, kubeconfigContent: trimmed, kubeconfigFilename: filename }),
        });
        const d = await res.json().catch(() => ({} as { error?: string; code?: string }));
        if (!res.ok) {
          const isUnreachable = (d as { code?: string }).code === "unreachable" || /unreachable/i.test(d.error ?? "") || /fetch failed/i.test(d.error ?? "");
          if (isUnreachable) {
            setClustersError(null);
            setNewClusterName("");
            setBulkPaste("");
            setBulkPasteOpen(false);
            await refreshClusters();
            return;
          }
          throw new Error(d.error ?? `Failed to create cluster (${res.status})`);
        }
        setNewClusterName("");
        setBulkPaste("");
        setBulkPasteOpen(false);
        await refreshClusters();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create cluster from pasted kubeconfig";
      // Surface full server message instead of generic fetch error
      setClustersError(msg.includes("fetch") ? `${msg} — check that the kubeconfig is valid YAML and under 500KB` : msg);
    } finally {
      setCreatingCluster(false);
    }
  }

  async function refreshGcpAgentStatus() {
    setGcpAgentLoading(true);
    try {
      const res = await fetch("/api/settings/trace-source/gcp/agent-status");
      const data = await res.json();
      if (!res.ok) {
        setGcpTraceError(data.error ?? "Failed to load GKE agent status.");
        return;
      }
      setGcpAgentClusters(data.clusters ?? []);
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to load GKE agent status.");
    } finally {
      setGcpAgentLoading(false);
    }
  }

  async function generateGcpTraceBundle() {
    setGcpTraceError(null);
    try {
      const res = await fetch("/api/settings/trace-source/gcp/files");
      const data = await res.json();
      if (!res.ok) {
        setGcpTraceError(data.error ?? "Failed to generate Terraform bundle.");
        return;
      }
      setGcpTraceBundle(data.bundle ?? null);
      setGcpTraceSource(data.config ?? gcpTraceSource);
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to generate Terraform bundle.");
    }
  }

  async function refreshLocalTunnelStatus() {
    try {
      const res = await fetch("/api/settings/trace-source/gcp/tunnel");
      const data = await res.json();
      if (res.ok) setLocalTunnel(data.status ?? null);
    } catch {}
  }

  async function startLocalTunnel(provider?: TunnelProvider) {
    setLocalTunnelAction("start");
    setGcpTraceError(null);
    try {
      const res = await fetch("/api/settings/trace-source/gcp/tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider ? { provider } : {}),
      });
      const data = await res.json();
      setLocalTunnel(data.status ?? null);
      if (!res.ok) {
        setGcpTraceError(data.error ?? data.status?.message ?? "Failed to start local test tunnel.");
      }
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to start local test tunnel.");
    } finally {
      setLocalTunnelAction(null);
    }
  }

  async function stopLocalTunnel() {
    setLocalTunnelAction("stop");
    setGcpTraceError(null);
    try {
      const res = await fetch("/api/settings/trace-source/gcp/tunnel", {
        method: "DELETE",
      });
      const data = await res.json();
      setLocalTunnel(data.status ?? null);
      if (!res.ok) {
        setGcpTraceError(data.error ?? "Failed to stop local test tunnel.");
      }
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to stop local test tunnel.");
    } finally {
      setLocalTunnelAction(null);
    }
  }

  function useTunnelUrl() {
    if (!localTunnel?.pushEndpoint) return;
    setGcpTraceSource((current) => current ? {
      ...current,
      mode: "streaming",
      pushEndpoint: localTunnel.pushEndpoint,
      pushAudience: localTunnel.pushEndpoint,
    } : current);
  }

  async function checkGcpTraceSetup() {
    setGcpTraceChecking(true);
    setGcpTraceError(null);
    try {
      const res = await fetch("/api/settings/trace-source/gcp/check", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setGcpTraceError(data.error ?? "Failed to check GCP trace setup.");
        return;
      }
      setGcpTraceSource(data.config ?? gcpTraceSource);
    } catch (e) {
      setGcpTraceError(e instanceof Error ? e.message : "Failed to check GCP trace setup.");
    } finally {
      setGcpTraceChecking(false);
    }
  }

  async function copyGeneratedFile(file: GeneratedFile) {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedFileName(file.name);
      setTimeout(() => setCopiedFileName((current) => current === file.name ? null : current), 2000);
    } catch {
      setGcpTraceError(`Failed to copy ${file.name}.`);
    }
  }

  async function copyAgentDeployCommand(cluster: GcpAgentClusterStatus) {
    try {
      await navigator.clipboard.writeText(cluster.deployCommand);
      setCopiedAgentCommand(cluster.clusterName);
      setTimeout(() => setCopiedAgentCommand((current) => current === cluster.clusterName ? null : current), 2000);
    } catch {
      setGcpTraceError(`Failed to copy deploy command for ${cluster.clusterName}.`);
    }
  }

  function downloadGeneratedFile(file: GeneratedFile) {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function traceSetupBadge(state: TraceSetupState) {
    switch (state) {
      case "receiving_events":
        return { label: "Active", className: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10" };
      case "resources_applied":
        return { label: "Resources Applied", className: "text-sky-400 border-sky-500/25 bg-sky-500/10" };
      case "terraform_generated":
        return { label: "Terraform Ready", className: "text-amber-400 border-amber-500/25 bg-amber-500/10" };
      default:
        return { label: "Not Configured", className: "text-slate-400 border-slate-600/30 bg-slate-700/30" };
    }
  }

  async function saveKey(provider: AIProvider) {
    const apiKey = inputs[provider].trim();
    if (!apiKey) return;
    setSaving((s) => ({ ...s, [provider]: true }));

    if (saveToBrowser[provider]) {
      // Save to browser storage
      try {
        const res = await fetch("/api/settings/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey, dryRun: true }), // Dry run for browser keys
        });
        const data = await res.json();
        if (!res.ok) {
          addError(provider, data.error ?? "Key validation failed");
          return;
        }
        setBrowserAIKey(provider, apiKey);
        setBrowserKeys(getBrowserAIKeys());
        setInputs((i) => ({ ...i, [provider]: "" }));
      } catch (e) {
        addError(provider, e instanceof Error ? e.message : "Network error during validation");
      } finally {
        setSaving((s) => ({ ...s, [provider]: false }));
      }
    } else {
      // Save to server
      try {
        const res = await fetch("/api/settings/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey }),
        });
        const data = await res.json();
        if (!res.ok) { addError(provider, data.error ?? "Unknown error"); return; }
        setKeys(data.keys);
        setInputs((i) => ({ ...i, [provider]: "" }));
      } catch (e) {
        addError(provider, e instanceof Error ? e.message : "Network error");
      } finally {
        setSaving((s) => ({ ...s, [provider]: false }));
      }
    }
  }

  async function deleteKey(provider: AIProvider) {
    setDeleting((d) => ({ ...d, [provider]: true }));
    try {
      const res = await fetch(`/api/settings/keys/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { addError(provider, data.error ?? "Delete failed"); return; }
      setKeys(data.keys);
    } catch (e) {
      addError(provider, e instanceof Error ? e.message : "Network error");
    } finally {
      setDeleting((d) => ({ ...d, [provider]: false }));
    }
  }

  function deleteBrowserKey(provider: AIProvider) {
    removeBrowserAIKey(provider);
    setBrowserKeys(getBrowserAIKeys());
  }

  async function setActive(provider: AIProvider, isBrowserStored?: boolean) {
    if (isBrowserStored) {
      setActiveBrowserProvider(provider);
      setBrowserKeys(getBrowserAIKeys());
      return;
    }

    setActivating(provider);
    try {
      const res = await fetch("/api/settings/keys/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) { addError(provider, data.error ?? "Failed to set active"); return; }
      setKeys(data.keys);
    } catch (e) {
      addError(provider, e instanceof Error ? e.message : "Network error");
    } finally {
      setActivating(null);
    }
  }

  async function saveCloudCred(provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github") {
    setCloudSaving((s) => ({ ...s, [provider]: true }));
    setCloudErrors((e) => ({ ...e, [provider]: "" }));
    try {
      let credentials;
      if (provider === "gcp") {
        credentials = { serviceAccountKey: gcpKeyInput.trim() };
      } else if (provider === "aws") {
        credentials = awsAuthMode === "role"
          ? {
              roleArn: awsRoleInputs.roleArn.trim(),
              externalId: awsRoleInputs.externalId.trim(),
              region: awsRoleInputs.region.trim() || "us-east-1",
            }
          : {
              accessKeyId: awsInputs.accessKeyId.trim(),
              secretAccessKey: awsInputs.secretAccessKey.trim(),
              region: awsInputs.region.trim() || "us-east-1",
            };
      } else if (provider === "ghcr") {
        credentials = { token: ghcrToken.trim() };
      } else if (provider === "dockerhub") {
        credentials = { username: dockerHubInputs.username.trim(), token: dockerHubInputs.token.trim() };
      } else if (provider === "github") {
        credentials = { token: githubToken.trim() };
      }
      const res = await fetch("/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      });
      const data = await res.json();
      if (!res.ok) { setCloudErrors((e) => ({ ...e, [provider]: data.error ?? "Unknown error" })); return; }
      setCloudCreds(data.credentials);
      if (provider === "gcp") setGcpKeyInput("");
      else if (provider === "aws") {
        setAwsInputs({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
        setAwsRoleInputs({ roleArn: "", externalId: "", region: "us-east-1" });
      }
      else if (provider === "ghcr") setGhcrToken("");
      else if (provider === "dockerhub") setDockerHubInputs({ username: "", token: "" });
      else if (provider === "github") setGithubToken("");
    } catch (e) {
      setCloudErrors((err) => ({ ...err, [provider]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setCloudSaving((s) => ({ ...s, [provider]: false }));
    }
  }

  async function deleteCloudCred(provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github") {
    setCloudDeleting((d) => ({ ...d, [provider]: true }));
    try {
      const res = await fetch(`/api/settings/credentials/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setCloudErrors((e) => ({ ...e, [provider]: data.error ?? "Delete failed" })); return; }
      setCloudCreds(data.credentials);
    } catch (e) {
      setCloudErrors((err) => ({ ...err, [provider]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setCloudDeleting((d) => ({ ...d, [provider]: false }));
    }
  }

  async function saveGithubRemediationDefaults() {
    if (!githubRemediationRepoFullName || !githubRemediationBranch) return;
    setGithubRemediationSaving(true);
    setGithubRemediationError(null);
    try {
      const res = await fetch("/api/settings/github-remediation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: githubRemediationRepoFullName,
          defaultBranch: githubRemediationBranch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGithubRemediationError(data.error ?? "Failed to save GitHub remediation defaults.");
        return;
      }
      setGithubRemediationDefaults(data.defaults ?? null);
    } catch (e) {
      setGithubRemediationError(e instanceof Error ? e.message : "Failed to save GitHub remediation defaults.");
    } finally {
      setGithubRemediationSaving(false);
    }
  }

  // ── Demo credential handlers (browser-only, no server calls) ────────────

  function saveDemoGcpCred() {
    const key = demoGcpInput.trim();
    if (!key) return;
    try {
      JSON.parse(key); // validate JSON
    } catch {
      addError("gcp-demo", "Invalid JSON — paste the full service account key file");
      return;
    }
    setDemoGcpCredentials({ serviceAccountKey: key });
    setDemoCreds(getDemoCredentials());
    setDemoGcpInput("");
    setDemoSaved((s) => ({ ...s, gcp: true }));
    setTimeout(() => setDemoSaved((s) => ({ ...s, gcp: false })), 3000);
  }

  function saveDemoAwsCred() {
    const { accessKeyId, secretAccessKey, region } = demoAwsInputs;
    if (!accessKeyId.trim() || !secretAccessKey.trim()) return;
    setDemoAwsCredentials({ accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), region: region.trim() || "us-east-1" });
    setDemoCreds(getDemoCredentials());
    setDemoAwsInputs({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
    setDemoSaved((s) => ({ ...s, aws: true }));
    setTimeout(() => setDemoSaved((s) => ({ ...s, aws: false })), 3000);
  }

  function removeDemoCred(provider: "gcp" | "aws") {
    clearDemoCredentials(provider);
    setDemoCreds(getDemoCredentials());
  }

  const hasAnyKey = keys.length > 0;
  const activeKey = keys.find((k) => k.isActive);

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-xs uppercase tracking-widest transition-colors shrink-0" style={{ color: "var(--text-muted)" }}>
          <ArrowLeft className="w-3 h-3" />
          Dashboard
        </Link>
        <div className="flex-1 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tighter" style={{ color: "var(--text-strong)" }}>SETTINGS</h1>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-6 border-b" style={{ borderColor: "var(--border-dim)" }}>
        {(["ai", "integrations", "alerts", "diagnostics"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-3 text-xs font-bold uppercase tracking-widest transition-colors relative",
              activeTab === tab ? "text-emerald-400" : "text-slate-500 hover:text-slate-300"
            )}
            style={activeTab === tab ? { color: "var(--green)" } : {}}
          >
            {tab === "ai" && "AI Models"}
            {tab === "integrations" && "Integrations"}
            {tab === "alerts" && "Alerts"}
            {tab === "diagnostics" && "Diagnostics"}
            {activeTab === tab && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-0.5" style={{ background: "var(--green)" }} />
            )}
          </button>
        ))}
      </div>

      {/* AI Block */}
      {activeTab === "ai" && (
        <div className="space-y-8 mt-6">
          {/* Active key summary */}
      {activeKey && (
        <div className="flex items-center gap-2 px-3 py-2 border border-emerald-500/20" style={{ background: "rgba(16, 185, 129, 0.05)" }}>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            Active provider: <span className="font-semibold">{PROVIDERS.find((p) => p.id === activeKey.provider)?.name}</span>
            <span className="ml-2 font-mono text-emerald-400/70">····{activeKey.keyHint}</span>
          </p>
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider text-green-500">AI Provider Keys</h2>
        </div>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse h-32" style={{ background: "var(--bg-card2)", border: "1px solid var(--border-dim)" }} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {PROVIDERS.map((prov) => {
              const isSaving = saving[prov.id];
              const isDeleting = deleting[prov.id];
              const isActivating = activating === prov.id;
              const serverRecord = keys.find((k) => k.provider === prov.id);
              const browserKey = browserKeys[prov.id];
              const activeBrowserProv = getActiveBrowserProvider();

              const isBrowserStored = !!browserKey;
              const isActive = isBrowserStored
                ? activeBrowserProv === prov.id || (!activeBrowserProv && Object.keys(browserKeys)[0] === prov.id)
                : serverRecord?.isActive;

              const record = isBrowserStored ? { provider: prov.id, keyHint: browserKey.slice(-4), isActive } : serverRecord;

              return (
                <div
                  key={prov.id}
                  className={cn(
                    "rounded-xl border p-5 space-y-4 transition-all duration-150",
                    prov.bg, prov.border,
                    isActive && "ring-1 ring-emerald-500/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0", prov.accent)}>
                        {prov.logo}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm font-semibold", prov.color)}>{prov.name}</span>
                          {isActive && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-emerald-500/15 border border-emerald-500/25 text-emerald-400">
                              <Star className="w-2.5 h-2.5" />Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{prov.description}</p>
                        <p className="text-xs font-mono mt-0.5" style={{ color: "var(--border-dim)" }}>Model: {prov.models}</p>
                      </div>
                    </div>
                    {record ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green)" }}>
                          <Check className="w-3 h-3" />
                          <span className="font-mono">····{record.keyHint}</span>
                          {isBrowserStored && (
                            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-sans font-normal uppercase tracking-wider" style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}>
                              Browser
                            </span>
                          )}
                        </span>
                        {!isActive && (keys.length > 1 || Object.keys(browserKeys).length > 1) && (
                          <button
                            onClick={() => setActive(prov.id, isBrowserStored)}
                            disabled={isActivating}
                            className="terminal-btn text-xs px-2 py-0.5"
                          >
                            {isActivating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set active"}
                          </button>
                        )}
                        <button
                          onClick={() => isBrowserStored ? deleteBrowserKey(prov.id) : deleteKey(prov.id)}
                          disabled={isDeleting}
                          className="hover:text-red-400 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                          title="Remove key"
                        >
                          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>Not configured</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showKey[prov.id] ? "text" : "password"}
                          value={inputs[prov.id]}
                          onChange={(e) => setInputs((i) => ({ ...i, [prov.id]: e.target.value }))}
                          placeholder={record ? `Update key (${prov.placeholder})` : `Paste API key (${prov.placeholder})`}
                          className="w-full pl-3 pr-9 py-2 bg-transparent border text-sm placeholder:opacity-30 outline-none font-mono text-xs"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                          onKeyDown={(e) => e.key === "Enter" && saveKey(prov.id)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((s) => ({ ...s, [prov.id]: !s[prov.id] }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-white transition-colors"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {showKey[prov.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <button
                        onClick={() => saveKey(prov.id)}
                        disabled={!inputs[prov.id].trim() || isSaving}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                        style={
                          inputs[prov.id].trim() && !isSaving
                            ? { background: "var(--green)", color: "var(--bg)" }
                            : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                        }
                      >
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {isSaving ? "Testing…" : record ? "Update" : "Add & Test"}
                      </button>
                    </div>

                  </div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--border-dim)" }}>
                    Key is tested before saving and stored encrypted. Never shared with third parties.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>Local & Self-Hosted Kubernetes</h2>
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-widest border" style={{ color: "var(--text-muted)", borderColor: "var(--border-dim)" }}>k3s · k0s · microk8s · kind · minikube · self-hosted</span>
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Attach any kubeconfig — local workstation, on-prem, or edge (k3s/k0s/microk8s/kind/minikube/talos/RKE2/generic). Watchmen discovers services, workloads, pods and pod logs, and lets you scan + live-trace them without GCP or AWS.
          </p>
        </div>

        {isDemoUser ? (
          <div className="border p-4 text-xs" style={{ borderColor: "var(--border-dim)", background: "rgba(15, 23, 42, 0.45)", color: "var(--text-muted)" }}>
            Self-managed clusters are disabled in demo mode.
          </div>
        ) : clustersLoading || localKubernetesLoading ? (
          <div className="animate-pulse h-44" style={{ background: "var(--bg-card2)", border: "1px solid var(--border-dim)" }} />
        ) : (
          <div className="border p-5 space-y-5" style={{ background: "rgba(14, 165, 233, 0.04)", borderColor: "rgba(14, 165, 233, 0.16)" }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>Self-Managed Kubernetes — Multiple Clusters</span>
                  <span className="px-2 py-0.5 border text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400" style={{ borderColor: "rgba(16,185,129,0.25)" }}>{clusters.length} clusters</span>
                  {clusters.some((c) => c.hasKubeconfig) && (
                    <span className="px-2 py-0.5 border text-[10px] font-mono bg-slate-800/60 text-slate-300" style={{ borderColor: "var(--border-dim)" }}>
                      {clusters.filter((c) => c.hasKubeconfig).length} with kubeconfig
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Add any number of kubeconfigs — local, k3s, k0s, microk8s, kind, minikube, talos, RKE2, generic on-prem. Each cluster is scanned, traced and queried independently.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshClusters} disabled={clustersLoading} className="terminal-btn text-xs px-3 py-1.5 inline-flex items-center gap-1">
                  {clustersLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Refresh
                </button>
                <Link href="/dashboard/self-managed" className="terminal-btn text-xs px-3 py-1.5 inline-flex items-center gap-1">View all →</Link>
              </div>
            </div>

            {/* Add cluster form */}
            <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.35)" }}>
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--text-muted)" }}>Add cluster</p>
              <div className="flex gap-2 flex-wrap">
                <input value={newClusterName} onChange={(e) => setNewClusterName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createCluster()} placeholder="prod-k3s-east, staging-k0s, kind-dev … (leave empty to auto-derive from kubeconfig)" className="flex-1 min-w-[180px] px-3 py-2 bg-slate-900/60 border text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }} />
                <button onClick={createCluster} disabled={!newClusterName.trim() || creatingCluster} className="terminal-btn text-xs px-4 py-2 inline-flex items-center gap-1 font-bold" style={{ background: newClusterName.trim() ? "#10b981" : undefined, color: newClusterName.trim() ? "#000" : undefined }}>
                  {creatingCluster ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add cluster
                </button>
                <label className={cn("terminal-btn text-xs px-4 py-2 inline-flex items-center gap-1 cursor-pointer", creatingCluster && "opacity-50 pointer-events-none")} style={{ border: "1px dashed var(--border-dim)" }}>
                  <Plus className="w-3.5 h-3.5" /> Add from kubeconfig
                  <input
                    type="file"
                    accept=".yaml,.yml,.kubeconfig,.txt,*/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 500 * 1024) { setClustersError("File too large — max 500 KB."); e.target.value = ""; return; }
                      const text = await file.text();
                      // Parse all contexts from merged kubeconfig — each context becomes a separate cluster
                      const contextsBlockMatch = text.match(/contexts:\s*\n([\s\S]*?)(?=\n[a-zA-Z0-9_-]+\s*:|$)/);
                      const contextsBlock = contextsBlockMatch ? contextsBlockMatch[1] : text;
                      // Find all context entries: "- name: <ctx>" followed by "cluster: <cluster>" and optional "namespace:"
                      const contextEntries: Array<{ name: string; cluster: string; namespace?: string }> = [];
                      const contextRegex = /-\s*name:\s*([^\s\n]+)\s*\n[\s\S]*?cluster:\s*([^\s\n]+)(?:\s*\n[\s\S]*?namespace:\s*([^\s\n]+))?/g;
                      // If we have a contexts block, scope regex there; else global
                      const searchText = contextsBlock.includes("cluster:") ? contextsBlock : text;
                      let m: RegExpExecArray | null;
                      const seen = new Set<string>();
                      while ((m = contextRegex.exec(searchText)) !== null) {
                        const n = m[1].replace(/["']/g, "").trim();
                        const c = m[2].replace(/["']/g, "").trim();
                        if (n && !seen.has(n)) {
                          seen.add(n);
                          contextEntries.push({ name: n, cluster: c, namespace: m[3]?.replace(/["']/g, "").trim() });
                        }
                        if (contextEntries.length >= 20) break; // safety cap
                      }
                      // Fallback: if no contexts parsed, treat as single cluster
                      const isMerged = contextEntries.length > 1;
                      const sanitize = (s: string) => s.replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || s.slice(0, 64);
                      setCreatingCluster(true);
                      setClustersError(null);
                      try {
                        if (isMerged) {
                          // Create one cluster per context, all sharing the same merged kubeconfig but pinned to different context
                          let created = 0;
                          let lastError: string | null = null;
                          const unreachableNames: string[] = [];
                          const otherErrors: string[] = [];
                          for (const ctx of contextEntries) {
                            const base = ctx.cluster || ctx.name;
                            let derived = sanitize(base) || sanitize(ctx.name) || `cluster-${Date.now().toString(36)}`;
                            // If user typed a prefix, prepend it
                            const prefix = newClusterName.trim();
                            let nameToUse = prefix ? `${prefix}-${derived}`.slice(0, 64) : derived;
                            // De-duplicate against existing clusters and within this batch
                            const existingNames = new Set(clusters.map((c) => c.name));
                            let suffix = 1;
                            let candidate = nameToUse;
                            while (existingNames.has(candidate) && suffix < 20) {
                              suffix += 1;
                              candidate = `${nameToUse}-${suffix}`.slice(0, 64);
                            }
                            nameToUse = candidate;
                            existingNames.add(nameToUse);
                            const res = await fetch("/api/kubernetes/clusters", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ name: nameToUse, enabled: true, kubeconfigContent: text, kubeconfigFilename: file.name, context: ctx.name, namespace: ctx.namespace ?? "watchmen" }),
                            });
                            const d = await res.json().catch(() => ({} as { error?: string; code?: string }));
                            if (!res.ok) {
                              const errMsg = d.error ?? `Failed for ${nameToUse}`;
                              const isUnreachable = d.code === "unreachable" || /unreachable/i.test(errMsg);
                              if (isUnreachable) unreachableNames.push(nameToUse);
                              else otherErrors.push(errMsg);
                              lastError = errMsg;
                              // continue to next, but remember error
                            } else {
                              created += 1;
                            }
                          }
                          if (created === 0) {
                            if (unreachableNames.length === contextEntries.length) {
                              // All unreachable — silently ignore per request, don't surface fetch failed
                              setNewClusterName("");
                              await refreshClusters();
                              return;
                            }
                            throw new Error(lastError ?? "Failed to create clusters from merged kubeconfig");
                          }
                          if (created < contextEntries.length) {
                            // Only surface non-unreachable errors; unreachable are silently ignored
                            if (otherErrors.length) {
                              setClustersError(`Added ${created}/${contextEntries.length} clusters. Errors: ${otherErrors.slice(0, 3).join(" | ")}`);
                            } else {
                              // Clear any previous error — unreachable are ignored
                              setClustersError(null);
                            }
                          } else {
                            setClustersError(null);
                          }
                          setNewClusterName("");
                          await refreshClusters();
                        } else {
                          // Single cluster path — derive name as before
                          let derived = "";
                          const clusterMatch = text.match(/clusters:\s*\n\s*-\s*name:\s*([^\s\n]+)/);
                          if (clusterMatch) derived = clusterMatch[1].replace(/["']/g, "");
                          if (!derived) {
                            const ctxCluster = text.match(/contexts:\s*\n[\s\S]*?cluster:\s*([^\s\n]+)/);
                            if (ctxCluster) derived = ctxCluster[1].replace(/["']/g, "");
                          }
                          if (!derived) derived = file.name.replace(/\.(yaml|yml|kubeconfig|txt)$/i, "").replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64) || `cluster-${Date.now().toString(36)}`;
                          derived = derived.trim().slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || derived;
                          if (!derived) derived = `cluster-${Date.now().toString(36)}`;
                          const nameToUse = newClusterName.trim() || derived;
                          const res = await fetch("/api/kubernetes/clusters", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: nameToUse, enabled: true, kubeconfigContent: text, kubeconfigFilename: file.name }),
                          });
                          const d = await res.json().catch(() => ({} as { error?: string; code?: string }));
                          if (!res.ok) {
                            const isUnreachable = (d as { code?: string }).code === "unreachable" || /unreachable/i.test((d as { error?: string }).error ?? "") || /fetch failed/i.test((d as { error?: string }).error ?? "");
                            if (isUnreachable) {
                              setClustersError(null);
                              setNewClusterName("");
                              await refreshClusters();
                              return;
                            }
                            throw new Error(d.error ?? "Failed to create cluster");
                          }
                          setNewClusterName("");
                          await refreshClusters();
                        }
                      } catch (err) {
                        setClustersError(err instanceof Error ? err.message : "Failed to create cluster from kubeconfig");
                      } finally {
                        setCreatingCluster(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>Name is auto-derived from the <span className="font-mono">cluster</span> / <span className="font-mono">context.cluster</span> in your kubeconfig — edit it above if needed. Or use <b>Add from kubeconfig</b> to create and upload in one step. Merged kubeconfigs (multiple <span className="font-mono">contexts</span>) will create <b>{`one cluster per context`}</b> automatically.</p>
              {clustersError && <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{clustersError}</p>}
              <div className="space-y-2">
                <button onClick={() => setBulkPasteOpen((v) => !v)} className="text-[11px] font-mono underline" style={{ color: "var(--text-muted)" }}>
                  {bulkPasteOpen ? "Hide paste" : "Or paste merged kubeconfig →"}
                </button>
                {bulkPasteOpen && (
                  <div className="space-y-2 border p-2" style={{ borderColor: "var(--border-dim)", background: "rgba(15,23,42,0.4)" }}>
                    <textarea value={bulkPaste} onChange={(e) => setBulkPaste(e.target.value)} placeholder="Paste merged kubeconfig YAML (apiVersion: v1, clusters:, users:, contexts:, current-context:) — all contexts will become separate clusters" rows={6} className="w-full px-3 py-2 bg-slate-900/60 border text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }} />
                    <div className="flex gap-2 items-center flex-wrap">
                      <button onClick={() => createClustersFromPastedKubeconfig(bulkPaste, "pasted-merged.yaml")} disabled={!bulkPaste.trim() || creatingCluster} className={cn("terminal-btn text-xs px-3 py-1.5 inline-flex items-center gap-1", (!bulkPaste.trim() || creatingCluster) && "opacity-40")}>
                        {creatingCluster ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Add all from paste
                      </button>
                      <span className="text-[11px] font-mono" style={{ color: bulkPaste.length > 500*1024 ? "#ef4444" : "var(--text-muted)" }}>{bulkPaste.length.toLocaleString()} chars · {bulkPaste ? Math.round(bulkPaste.length/1024)+" KB" : "0 KB"} / 500 KB · {bulkPaste ? (bulkPaste.match(/-\s*name:/g)?.length ?? 0)+" contexts detected" : ""}</span>
                    </div>
                  </div>
                )}
              </div>
              {clusters.length === 0 && !clustersLoading && (
                <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>No clusters yet — add your first above. Tip: <span className="select-all">kind create cluster && kind get kubeconfig --name kind &gt; kubeconfig.yaml</span> then upload it in the card.</p>
              )}
            </div>

            {/* Cluster cards */}
            {clusters.length > 0 ? (
              <div className="space-y-4">
                {clusters.map((c) => (
                  <SelfManagedClusterCard key={c.id} cluster={c} onDelete={refreshClusters} onRenamed={refreshClusters} />
                ))}
              </div>
            ) : (
              !clustersLoading && (
                <div className="border-2 border-dashed p-6 text-center" style={{ borderColor: "var(--border-dim)", color: "var(--text-muted)" }}>
                  <p className="text-xs font-mono">No self-managed clusters — add one above to get started.</p>
                  <p className="text-[11px] font-mono mt-1">Each cluster has its own kubeconfig, context, namespace filter and Enable toggle. Scan & Live Trace work per-cluster.</p>
                </div>
              )
            )}

            {/* Legacy single-config note */}
            {clusters.length > 0 && localKubernetesStatus?.hasKubeconfig && (
              <div className="text-[11px] font-mono p-2 border" style={{ borderColor: "var(--border-dim)", background: "rgba(15,23,42,0.3)", color: "var(--text-muted)" }}>
                Legacy single-cluster config was auto-migrated as <b style={{ color: "#e5e7eb" }}>default</b>. You can delete the legacy entry via the old API or keep it.
              </div>
            )}
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Tip: Keep your kubeconfig file merged (kubectl config view --flatten) if you prefer one file with many contexts — or keep clusters separate as above for isolated health, trace filtering and per-cluster enable/disable.
            </p>
          </div>
        )}

      {/* Integrations Block */}      </div>
        </div>
      )}

      {/* Integrations Block */}
      {activeTab === "integrations" && (
        <div className="space-y-8 mt-6">
          {/* Cloud Credentials */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>Cloud Credentials</h2>
        </div>

        {cloudLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="animate-pulse h-40" style={{ background: "var(--bg-card2)", border: "1px solid var(--border-dim)" }} />
            ))}
          </div>
        ) : isDemoUser ? (
          // ── Browser-only demo credentials ────────────────────────────────
          <div className="space-y-3">
            {/* GCP Demo Card */}
            {(() => {
              const stored = demoCreds.gcp;
              return (
                <div className="border p-5 space-y-4" style={{ background: "rgba(59, 130, 246, 0.05)", borderColor: "rgba(59, 130, 246, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-blue-500">G</div>
                      <div>
                        <span className="text-sm font-bold text-blue-500">Google Cloud Platform</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Service account key · browser session only</p>
                      </div>
                    </div>
                    {stored ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check className="w-3 h-3" /> Stored in browser
                        </span>
                        <button onClick={() => removeDemoCred("gcp")} className="text-slate-600 hover:text-red-400 transition-colors" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">Not configured</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <textarea
                      value={demoGcpInput}
                      onChange={(e) => setDemoGcpInput(e.target.value)}
                      placeholder={stored ? "Paste new service account JSON to replace" : "Paste service account JSON key"}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono resize-none"
                    />
                    <button
                      onClick={saveDemoGcpCred}
                      disabled={!demoGcpInput.trim()}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                        demoGcpInput.trim()
                          ? "bg-blue-500 text-white hover:opacity-90"
                          : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                      )}
                    >
                      {demoSaved.gcp ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      {demoSaved.gcp ? "Saved to browser!" : stored ? "Replace" : "Save to browser"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* AWS Demo Card */}
            {(() => {
              const stored = demoCreds.aws;
              return (
                <div className="border p-5 space-y-4" style={{ background: "rgba(249, 115, 22, 0.05)", borderColor: "rgba(249, 115, 22, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-orange-500">A</div>
                      <div>
                        <span className="text-sm font-bold text-orange-500">Amazon Web Services</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>IAM access keys · browser session only</p>
                      </div>
                    </div>
                    {stored ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check className="w-3 h-3" /> Stored in browser
                        </span>
                        <button onClick={() => removeDemoCred("aws")} className="text-slate-600 hover:text-red-400 transition-colors" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">Not configured</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={demoAwsInputs.accessKeyId}
                      onChange={(e) => setDemoAwsInputs((i) => ({ ...i, accessKeyId: e.target.value }))}
                      placeholder={stored ? "New Access Key ID (leave blank to keep)" : "Access Key ID (AKIA...)"}
                      className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                      style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    />
                    <div className="relative">
                      <input
                        type={showDemoAwsSecret ? "text" : "password"}
                        value={demoAwsInputs.secretAccessKey}
                        onChange={(e) => setDemoAwsInputs((i) => ({ ...i, secretAccessKey: e.target.value }))}
                        placeholder="Secret Access Key"
                        className="w-full pl-3 pr-9 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <button type="button" onClick={() => setShowDemoAwsSecret((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-white transition-colors" style={{ color: "var(--text-muted)" }}>
                        {showDemoAwsSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={demoAwsInputs.region}
                      onChange={(e) => setDemoAwsInputs((i) => ({ ...i, region: e.target.value }))}
                      placeholder="Region (default: us-east-1)"
                      className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                      style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    />
                    <button
                      onClick={saveDemoAwsCred}
                      disabled={!demoAwsInputs.accessKeyId.trim() || !demoAwsInputs.secretAccessKey.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        demoAwsInputs.accessKeyId.trim() && demoAwsInputs.secretAccessKey.trim()
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {demoSaved.aws ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      {demoSaved.aws ? "Saved to browser!" : stored ? "Replace" : "Save to browser"}
                    </button>
                  </div>
                </div>
              );
            })()}

            <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <ShieldCheck className="w-3 h-3" />
              Go back to the dashboard and click Sync — your real cloud data will be scanned using these credentials.
            </p>
          </div>
        ) : (
          // ── Server-backed credentials (non-demo users) ───────────────────
          <div className="space-y-3">
            {/* GCP Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "gcp");
              const isSaving = cloudSaving.gcp;
              const isDeleting = cloudDeleting.gcp;
              const error = cloudErrors.gcp;
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(59, 130, 246, 0.05)", borderColor: "rgba(59, 130, 246, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-blue-500">G</div>
                      <div>
                        <span className="text-sm font-bold text-blue-500">Google Cloud Platform</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Service account key for GCP scanning</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button onClick={() => deleteCloudCred("gcp")} disabled={isDeleting} className="text-slate-600 hover:text-red-400 transition-colors">
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">Not configured</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <textarea
                      value={gcpKeyInput}
                      onChange={(e) => setGcpKeyInput(e.target.value)}
                      placeholder={record ? "Paste new service account JSON to update" : "Paste service account JSON key"}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono resize-none"
                    />
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("gcp")}
                      disabled={!gcpKeyInput.trim() || isSaving}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                        gcpKeyInput.trim() && !isSaving ? "bg-blue-500 text-white hover:opacity-90" : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                      )}
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update & Test" : "Connect & Test"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* AWS Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "aws");
              const isSaving = cloudSaving.aws;
              const isDeleting = cloudDeleting.aws;
              const error = cloudErrors.aws;
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(249, 115, 22, 0.05)", borderColor: "rgba(249, 115, 22, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-orange-500">A</div>
                      <div>
                        <span className="text-sm font-bold" style={{ color: "var(--amber)" }}>Amazon Web Services</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Access keys are the default connection method. Role ARN remains available for AssumeRole setups.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green)" }}>
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button onClick={() => deleteCloudCred("aws")} disabled={isDeleting} className="hover:text-red-400 transition-colors" style={{ color: "var(--text-muted)" }}>
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>Not configured</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="inline-flex border text-xs font-mono" style={{ borderColor: "var(--border-dim)" }}>
                      <button
                        type="button"
                        onClick={() => setAwsAuthMode("keys")}
                        className="px-3 py-2"
                        style={awsAuthMode === "keys" ? { background: "var(--green)", color: "var(--bg)" } : { color: "var(--text-muted)" }}
                      >
                        Access keys
                      </button>
                      <button
                        type="button"
                        onClick={() => setAwsAuthMode("role")}
                        className="px-3 py-2"
                        style={awsAuthMode === "role" ? { background: "var(--green)", color: "var(--bg)" } : { color: "var(--text-muted)" }}
                      >
                        Role ARN
                      </button>
                    </div>
                    {awsAuthMode === "role" ? (
                      <>
                        <input type="text" value={awsRoleInputs.roleArn} onChange={(e) => setAwsRoleInputs((i) => ({ ...i, roleArn: e.target.value }))}
                          placeholder={record ? "New Role ARN" : "Role ARN (arn:aws:iam::123456789012:role/WatchmenReadOnly)"}
                          className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                        <input type="text" value={awsRoleInputs.externalId} onChange={(e) => setAwsRoleInputs((i) => ({ ...i, externalId: e.target.value }))}
                          placeholder="External ID (recommended)"
                          className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                        <input type="text" value={awsRoleInputs.region} onChange={(e) => setAwsRoleInputs((i) => ({ ...i, region: e.target.value }))}
                          placeholder="STS Region (default: us-east-1)"
                          className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </>
                    ) : (
                      <>
                        <input type="text" value={awsInputs.accessKeyId} onChange={(e) => setAwsInputs((i) => ({ ...i, accessKeyId: e.target.value }))}
                          placeholder={record ? "New Access Key ID" : "Access Key ID (AKIA...)"}
                          className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                        <div className="relative">
                          <input type={showAwsSecret ? "text" : "password"} value={awsInputs.secretAccessKey} onChange={(e) => setAwsInputs((i) => ({ ...i, secretAccessKey: e.target.value }))}
                            placeholder="Secret Access Key"
                            className="w-full pl-3 pr-9 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                            style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                          />
                          <button type="button" onClick={() => setShowAwsSecret((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-white transition-colors" style={{ color: "var(--text-muted)" }}>
                            {showAwsSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <input type="text" value={awsInputs.region} onChange={(e) => setAwsInputs((i) => ({ ...i, region: e.target.value }))}
                          placeholder="Region (default: us-east-1)"
                          className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </>
                    )}
                    {awsAuthMode === "role" && (
                      <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                        The Watchmen server must have base AWS credentials that can call sts:AssumeRole for this role.
                      </p>
                    )}
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("aws")}
                      disabled={(awsAuthMode === "role" ? !awsRoleInputs.roleArn.trim() : (!awsInputs.accessKeyId.trim() || !awsInputs.secretAccessKey.trim())) || isSaving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        (awsAuthMode === "role" ? awsRoleInputs.roleArn.trim() : (awsInputs.accessKeyId.trim() && awsInputs.secretAccessKey.trim())) && !isSaving
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update & Test" : awsAuthMode === "role" ? "Connect Role & Test" : "Connect Keys & Test"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* GHCR Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "ghcr");
              const isSaving = cloudSaving.ghcr;
              const isDeleting = cloudDeleting.ghcr;
              const error = cloudErrors.ghcr;
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(167, 139, 250, 0.05)", borderColor: "rgba(167, 139, 250, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-violet-500 rounded text-center">GH</div>
                      <div>
                        <span className="text-sm font-bold text-violet-400">GitHub Container Registry</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Personal Access Token for GHCR scanning</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green)" }}>
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button onClick={() => deleteCloudCred("ghcr")} disabled={isDeleting} className="hover:text-red-400 transition-colors" style={{ color: "var(--text-muted)" }}>
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>Not configured</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showGhcrToken ? "text" : "password"} value={ghcrToken} onChange={(e) => setGhcrToken(e.target.value)}
                        placeholder={record ? "New GitHub PAT (leave blank to keep existing)" : "GitHub Personal Access Token (ghp_...)"}
                        className="w-full pl-3 pr-9 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <button type="button" onClick={() => setShowGhcrToken((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-white transition-colors" style={{ color: "var(--text-muted)" }}>
                        {showGhcrToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("ghcr")}
                      disabled={!ghcrToken.trim() || isSaving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        ghcrToken.trim() && !isSaving
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update & Test" : "Connect & Test"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* GitHub PAT Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "github");
              const isSaving = cloudSaving.github;
              const isDeleting = cloudDeleting.github;
              const error = cloudErrors.github;
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(100, 116, 139, 0.05)", borderColor: "rgba(100, 116, 139, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 rounded text-center" style={{ background: "#24292e" }}>GH</div>
                      <div>
                        <span className="text-sm font-bold" style={{ color: "#94a3b8" }}>GitHub</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Personal Access Token for PR remediation</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green)" }}>
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button onClick={() => deleteCloudCred("github")} disabled={isDeleting} className="hover:text-red-400 transition-colors" style={{ color: "var(--text-muted)" }}>
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <input type={showGithubToken ? "text" : "password"} value={githubToken} onChange={(e) => setGithubToken(e.target.value)}
                        placeholder={record ? "New GitHub PAT (leave blank to keep existing)" : "GitHub Personal Access Token (ghp_...)"}
                        className="w-full pl-3 pr-9 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <button type="button" onClick={() => setShowGithubToken((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80" style={{ color: "var(--text-muted)" }}>
                        {showGithubToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("github")}
                      disabled={!githubToken.trim() || isSaving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        githubToken.trim() && !isSaving
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update & Test" : "Connect & Test"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* GitHub Remediation Defaults */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "github");
              const selectedRepo = githubRemediationRepos.find((repo) => repo.full_name === githubRemediationRepoFullName) ?? null;
              const filteredRepos = githubRemediationRepos.filter((repo) =>
                repo.full_name.toLowerCase().includes(githubRemediationRepoSearch.toLowerCase())
              );
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(16, 185, 129, 0.04)", borderColor: "rgba(16, 185, 129, 0.18)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>GitHub remediation defaults</span>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        Default repository and branch used when Watchmen opens remediation PRs.
                      </p>
                    </div>
                    {githubRemediationDefaults && (
                      <span className="text-xs font-mono" style={{ color: "var(--green)" }}>
                        {githubRemediationDefaults.repoFullName} @ {githubRemediationDefaults.defaultBranch}
                      </span>
                    )}
                  </div>

                  {!record ? (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Connect a GitHub PAT above first so Watchmen can load your repositories and branches.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={githubRemediationRepoSearch}
                        onChange={(e) => setGithubRemediationRepoSearch(e.target.value)}
                        placeholder="Search repositories…"
                        className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {githubRemediationLoading ? (
                          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Loading repositories…</p>
                        ) : filteredRepos.length === 0 ? (
                          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>No repositories found.</p>
                        ) : filteredRepos.map((repo) => (
                          <button
                            key={repo.full_name}
                            type="button"
                            onClick={() => setGithubRemediationRepoFullName(repo.full_name)}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors"
                            style={{
                              border: "1px solid",
                              borderColor: githubRemediationRepoFullName === repo.full_name ? "var(--green)" : "var(--border-dim)",
                              background: githubRemediationRepoFullName === repo.full_name ? "rgba(0,170,43,0.07)" : "transparent",
                            }}
                          >
                            <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                              {repo.full_name}
                            </span>
                            <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                              {repo.default_branch}
                            </span>
                          </button>
                        ))}
                      </div>

                      {selectedRepo && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Selected repository</label>
                            <div className="px-3 py-2 border text-xs font-mono" style={{ borderColor: "var(--border-dim)", color: "var(--text-primary)" }}>
                              {selectedRepo.full_name}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Default branch</label>
                            <select
                              value={githubRemediationBranch}
                              onChange={(e) => setGithubRemediationBranch(e.target.value)}
                              className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                              style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                            >
                              {githubRemediationBranchesLoading && <option value="">Loading branches…</option>}
                              {!githubRemediationBranchesLoading && githubRemediationBranches.length === 0 && <option value="">No branches found</option>}
                              {githubRemediationBranches.map((branch) => (
                                <option key={branch} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={saveGithubRemediationDefaults}
                          disabled={!githubRemediationRepoFullName || !githubRemediationBranch || githubRemediationSaving}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                          style={
                            githubRemediationRepoFullName && githubRemediationBranch && !githubRemediationSaving
                              ? { background: "var(--green)", color: "var(--bg)" }
                              : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                          }
                        >
                          {githubRemediationSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          {githubRemediationSaving ? "Saving…" : "Save default"}
                        </button>
                        {githubRemediationDefaults && (
                          <button
                            type="button"
                            onClick={async () => {
                              setGithubRemediationSaving(true);
                              setGithubRemediationError(null);
                              try {
                                const res = await fetch("/api/settings/github-remediation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
                                const data = await res.json();
                                if (!res.ok) {
                                  setGithubRemediationError(data.error ?? "Failed to clear GitHub remediation defaults.");
                                  return;
                                }
                                setGithubRemediationDefaults(null);
                                setGithubRemediationRepoFullName("");
                                setGithubRemediationBranch("");
                              } catch (e) {
                                setGithubRemediationError(e instanceof Error ? e.message : "Failed to clear GitHub remediation defaults.");
                              } finally {
                                setGithubRemediationSaving(false);
                              }
                            }}
                            className="text-xs font-mono"
                            style={{ color: "var(--text-muted)" }}
                          >
                            Clear default
                          </button>
                        )}
                      </div>

                      {githubRemediationError && (
                        <p className="text-xs text-red-400 font-mono">{githubRemediationError}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Docker Hub Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "dockerhub");
              const isSaving = cloudSaving.dockerhub;
              const isDeleting = cloudDeleting.dockerhub;
              const error = cloudErrors.dockerhub;
              return (
                <div className="border p-5 space-y-4 transition-all duration-150" style={{ background: "rgba(56, 189, 248, 0.05)", borderColor: "rgba(56, 189, 248, 0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-sky-500 rounded text-center">DH</div>
                      <div>
                        <span className="text-sm font-bold text-sky-400">Docker Hub</span>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Username & PAT for Docker Hub scanning</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green)" }}>
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button onClick={() => deleteCloudCred("dockerhub")} disabled={isDeleting} className="hover:text-red-400 transition-colors" style={{ color: "var(--text-muted)" }}>
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>Not configured</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <input type="text" value={dockerHubInputs.username} onChange={(e) => setDockerHubInputs((i) => ({ ...i, username: e.target.value }))}
                      placeholder={record ? "New Username (leave blank to keep existing)" : "Docker Hub Username"}
                      className="w-full px-3 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                      style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    />
                    <div className="relative">
                      <input type={showDockerHubToken ? "text" : "password"} value={dockerHubInputs.token} onChange={(e) => setDockerHubInputs((i) => ({ ...i, token: e.target.value }))}
                        placeholder="Docker Hub Access Token"
                        className="w-full pl-3 pr-9 py-2 bg-transparent border text-xs placeholder:opacity-30 outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <button type="button" onClick={() => setShowDockerHubToken((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-white transition-colors" style={{ color: "var(--text-muted)" }}>
                        {showDockerHubToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("dockerhub")}
                      disabled={(!dockerHubInputs.username.trim() || !dockerHubInputs.token.trim()) || isSaving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        (dockerHubInputs.username.trim() && dockerHubInputs.token.trim()) && !isSaving
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update & Test" : "Connect & Test"}
                    </button>
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>GCP Trace Source</h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Choose whether Watchmen should read live trace activity from Cloud Logging polling or from a Pub/Sub streaming integration.
          </p>
        </div>

        {isDemoUser ? (
          <div className="border p-4 text-xs" style={{ borderColor: "var(--border-dim)", background: "rgba(15, 23, 42, 0.45)", color: "var(--text-muted)" }}>
            GCP trace-source configuration is disabled in demo mode.
          </div>
        ) : gcpTraceLoading || !gcpTraceSource ? (
          <div className="animate-pulse h-56" style={{ background: "var(--bg-card2)", border: "1px solid var(--border-dim)" }} />
        ) : (
          (() => {
            const badge = traceSetupBadge(gcpTraceSource.setupState);
            const hasGcpCredential = cloudCreds.some((c) => c.provider === "gcp");
            return (
              <div className="border p-5 space-y-5" style={{ background: "rgba(16, 185, 129, 0.04)", borderColor: "rgba(16, 185, 129, 0.16)" }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: "var(--text-strong)" }}>Trace Source: GCP</span>
                      <span className={cn("px-2 py-0.5 border text-[10px] uppercase tracking-widest", badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {gcpTraceSource.lastCheckMessage}
                    </p>
                    {!hasGcpCredential && (
                      <p className="text-xs mt-2 text-amber-400">
                        Add GCP credentials above before checking streaming setup.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={checkGcpTraceSetup}
                      disabled={gcpTraceChecking || !hasGcpCredential}
                      className="terminal-btn text-xs px-3 py-1.5"
                    >
                      {gcpTraceChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Check setup"}
                    </button>
                    {gcpTraceSource.mode === "streaming" && (
                      <button
                        onClick={generateGcpTraceBundle}
                        className="terminal-btn text-xs px-3 py-1.5"
                      >
                        Generate Terraform
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    {
                      mode: "polling" as const,
                      title: "Cloud Logging Polling",
                      description: "Simpler setup. Higher latency and more Cloud Logging read traffic.",
                    },
                    {
                      mode: "streaming" as const,
                      title: "Pub/Sub Streaming",
                      description: "Lower latency. Requires Log Router, Pub/Sub, and Terraform apply steps.",
                    },
                  ]).map((option) => (
                    <button
                      key={option.mode}
                      onClick={() => setGcpTraceSource((current) => current ? {
                        ...current,
                        mode: option.mode,
                        pushEndpoint: option.mode === "streaming" && !current.pushEndpoint && typeof window !== "undefined"
                          ? getPublicHttpsPushEndpoint(window.location.origin)
                          : current.pushEndpoint,
                        pushAudience: option.mode === "streaming" && !current.pushAudience && typeof window !== "undefined"
                          ? getPublicHttpsPushEndpoint(window.location.origin)
                          : current.pushAudience,
                        setupState: option.mode === "polling"
                          ? "receiving_events"
                          : current.projectId.trim()
                            ? "terraform_generated"
                            : "not_configured",
                      } : current)}
                      className={cn(
                        "text-left border p-4 transition-colors",
                        gcpTraceSource.mode === option.mode ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700/70 hover:border-slate-500"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-strong)" }}>{option.title}</span>
                        <span className={cn("w-3 h-3 rounded-full border", gcpTraceSource.mode === option.mode ? "border-emerald-400 bg-emerald-400" : "border-slate-500")} />
                      </div>
                      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{option.description}</p>
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.25)" }}>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>Cloud Run / VM Source</h3>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Choose the live request source for Cloud Run services and Compute Engine VMs.</p>
                    </div>
                    {([
                      { id: "cloud_logging" as const, title: "Cloud Logging", description: "Poll request logs directly from GCP." },
                      { id: "pubsub" as const, title: "Pub/Sub", description: "Use the streaming Log Router sink when configured." },
                    ]).map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setGcpTraceSource((current) => current ? {
                          ...current,
                          computeSource: option.id,
                          mode: option.id === "pubsub" ? "streaming" : current.mode,
                          pushEndpoint: option.id === "pubsub" && !current.pushEndpoint && typeof window !== "undefined"
                            ? getPublicHttpsPushEndpoint(window.location.origin)
                            : current.pushEndpoint,
                          pushAudience: option.id === "pubsub" && !current.pushAudience && typeof window !== "undefined"
                            ? getPublicHttpsPushEndpoint(window.location.origin)
                            : current.pushAudience,
                        } : current)}
                        className={cn(
                          "w-full text-left border p-3 transition-colors",
                          gcpTraceSource.computeSource === option.id ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700/70 hover:border-slate-500"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold" style={{ color: "var(--text-strong)" }}>{option.title}</span>
                          <span className={cn("w-3 h-3 rounded-full border", gcpTraceSource.computeSource === option.id ? "border-emerald-400 bg-emerald-400" : "border-slate-500")} />
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{option.description}</p>
                      </button>
                    ))}
                  </div>

                  <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.25)" }}>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>GKE Source</h3>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Choose whether Kubernetes traffic comes from logs, Pub/Sub, or the Watchmen eBPF agent.</p>
                    </div>
                    {([
                      { id: "cloud_logging" as const, title: "Cloud Logging", description: "Poll k8s_container request logs." },
                      { id: "pubsub" as const, title: "Pub/Sub", description: "Use streaming request logs from the Log Router sink." },
                      { id: "ebpf_agent" as const, title: "eBPF Agent", description: "Use Watchmen's node DaemonSet HTTP capture." },
                    ]).map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setGcpTraceSource((current) => current ? {
                          ...current,
                          gkeSource: option.id,
                          mode: option.id === "pubsub" ? "streaming" : current.mode,
                          pushEndpoint: option.id === "pubsub" && !current.pushEndpoint && typeof window !== "undefined"
                            ? getPublicHttpsPushEndpoint(window.location.origin)
                            : current.pushEndpoint,
                          pushAudience: option.id === "pubsub" && !current.pushAudience && typeof window !== "undefined"
                            ? getPublicHttpsPushEndpoint(window.location.origin)
                            : current.pushAudience,
                        } : current)}
                        className={cn(
                          "w-full text-left border p-3 transition-colors",
                          gcpTraceSource.gkeSource === option.id ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700/70 hover:border-slate-500"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold" style={{ color: "var(--text-strong)" }}>{option.title}</span>
                          <span className={cn("w-3 h-3 rounded-full border", gcpTraceSource.gkeSource === option.id ? "border-emerald-400 bg-emerald-400" : "border-slate-500")} />
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{option.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {gcpTraceSource.gkeSource === "ebpf_agent" && (
                  <div className="border p-4 space-y-3" style={{ borderColor: "rgba(16, 185, 129, 0.18)", background: "rgba(6, 78, 59, 0.16)" }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>GKE eBPF Agent Coverage</h3>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Clusters from the latest GCP snapshot must have at least one healthy Watchmen agent node to emit eBPF trace events.</p>
                      </div>
                      <button
                        onClick={refreshGcpAgentStatus}
                        disabled={gcpAgentLoading}
                        className="terminal-btn text-xs px-3 py-1.5"
                      >
                        {gcpAgentLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Refresh Agents"}
                      </button>
                    </div>

                    {gcpAgentLoading && gcpAgentClusters.length === 0 ? (
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Checking agent registrations…</div>
                    ) : gcpAgentClusters.length === 0 ? (
                      <div className="text-xs text-amber-400">No GKE clusters found in the latest snapshot. Run a GCP scan first.</div>
                    ) : (
                      <div className="space-y-3">
                        {gcpAgentClusters.map((cluster) => (
                          <div key={`${cluster.projectId}/${cluster.location}/${cluster.clusterName}`} className="border p-3 space-y-2" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.35)" }}>
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div>
                                <div className="text-xs font-semibold" style={{ color: "var(--text-strong)" }}>{cluster.clusterName}</div>
                                <div className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{cluster.projectId} / {cluster.location}</div>
                              </div>
                              <span className={cn(
                                "px-2 py-0.5 border text-[10px] uppercase tracking-widest",
                                cluster.healthy
                                  ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/10"
                                  : cluster.installed
                                    ? "text-amber-400 border-amber-500/25 bg-amber-500/10"
                                    : "text-red-400 border-red-500/25 bg-red-500/10"
                              )}>
                                {cluster.healthy ? "Healthy" : cluster.installed ? "Registered" : "Missing"}
                              </span>
                            </div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                              Healthy nodes: <span className="font-mono" style={{ color: "var(--text-primary)" }}>{cluster.healthyCount}/{cluster.nodeCount || cluster.snapshotNodeCount || 0}</span>
                              {cluster.lastSeenAt ? <span> · Last seen: <span className="font-mono" style={{ color: "var(--text-primary)" }}>{new Date(cluster.lastSeenAt).toLocaleString()}</span></span> : null}
                            </div>
                            {!cluster.healthy && (
                              <div className="space-y-2">
                                <pre className="overflow-auto p-3 text-[10px] leading-5 font-mono whitespace-pre-wrap" style={{ background: "#05070d", border: "1px solid var(--border-dim)", color: "var(--text-primary)", maxHeight: 160 }}>
                                  {cluster.deployCommand}
                                </pre>
                                <button
                                  onClick={() => copyAgentDeployCommand(cluster)}
                                  className="terminal-btn text-xs px-3 py-1.5"
                                >
                                  {copiedAgentCommand === cluster.clusterName ? <Check className="w-3.5 h-3.5" /> : "Copy Deploy Command"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {gcpTraceSource.mode === "streaming" && (
                  <div className="space-y-4 border p-4" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.35)" }}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>GCP Project ID</label>
                        <input
                          type="text"
                          value={gcpTraceSource.projectId}
                          onChange={(e) => setGcpTraceSource((current) => current ? { ...current, projectId: e.target.value } : current)}
                          placeholder="watchmen-prod-project"
                          className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Region</label>
                        <input
                          type="text"
                          value={gcpTraceSource.region}
                          onChange={(e) => setGcpTraceSource((current) => current ? { ...current, region: e.target.value } : current)}
                          placeholder="us-central1"
                          className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Resource Prefix</label>
                        <input
                          type="text"
                          value={gcpTraceSource.namePrefix}
                          onChange={(e) => setGcpTraceSource((current) => current ? { ...current, namePrefix: e.target.value } : current)}
                          placeholder="watchmen-live-trace"
                          className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Push Endpoint</label>
                        <input
                          type="text"
                          value={gcpTraceSource.pushEndpoint}
                          onChange={(e) => setGcpTraceSource((current) => current ? { ...current, pushEndpoint: e.target.value } : current)}
                          placeholder="https://watchmen.example.com/api/ingest/gcp/pubsub"
                          className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                          style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Push Audience (Optional)</label>
                      <input
                        type="text"
                        value={gcpTraceSource.pushAudience}
                        onChange={(e) => setGcpTraceSource((current) => current ? { ...current, pushAudience: e.target.value } : current)}
                        placeholder="Optional OIDC audience for Pub/Sub push"
                        className="w-full px-3 py-2 bg-transparent border text-xs outline-none font-mono"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                    </div>

                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Pub/Sub push must target a public HTTPS Watchmen URL. Localhost and private-network addresses will not receive events from GCP.
                    </p>
                    {gcpTraceSource.pushEndpoint.trim() && validateStreamingPushEndpoint(gcpTraceSource.pushEndpoint) && (
                      <p className="text-xs text-amber-400">
                        {validateStreamingPushEndpoint(gcpTraceSource.pushEndpoint)}
                      </p>
                    )}

                  </div>
                )}

                {gcpTraceSource.mode === "streaming" && (
                  <div className="border p-4 space-y-4" style={{ borderColor: "var(--border-dim)", background: "rgba(8, 47, 73, 0.18)" }}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2">
                          <Wifi className="w-4 h-4 text-sky-400" />
                          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>Local Test Tunnel</h3>
                        </div>
                        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                          Start a temporary public tunnel to your local Watchmen instance so GCP Pub/Sub can push into `/api/ingest/gcp/pubsub`.
                        </p>
                      </div>
                      <button
                        onClick={refreshLocalTunnelStatus}
                        disabled={localTunnelLoading}
                        className="terminal-btn text-xs px-3 py-1.5"
                      >
                        Refresh Tunnel
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span
                        className={cn(
                          "px-2 py-0.5 border uppercase tracking-widest",
                          localTunnel?.state === "running"
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                            : localTunnel?.state === "starting"
                              ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
                              : localTunnel?.state === "error"
                                ? "border-red-500/25 bg-red-500/10 text-red-400"
                                : "border-slate-600/30 bg-slate-700/20 text-slate-400"
                        )}
                      >
                        {localTunnel?.state ?? "idle"}
                      </span>
                      {localTunnel?.provider && (
                        <span style={{ color: "var(--text-muted)" }}>
                          Provider: <span className="font-mono" style={{ color: "var(--text-primary)" }}>{localTunnel.provider}</span>
                        </span>
                      )}
                      {localTunnel?.publicUrl && (
                        <span style={{ color: "var(--text-muted)" }}>
                          URL: <span className="font-mono" style={{ color: "var(--text-primary)" }}>{localTunnel.publicUrl}</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {localTunnel?.message ?? "Detecting tunnel tooling..."}
                    </p>

                    {localTunnel?.availableProviders?.length ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => startLocalTunnel()}
                          disabled={localTunnelAction !== null || localTunnel?.state === "starting" || localTunnel?.state === "running"}
                          className="terminal-btn text-xs px-3 py-1.5"
                        >
                          {localTunnelAction === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Start Test Tunnel"}
                        </button>
                        <button
                          onClick={stopLocalTunnel}
                          disabled={localTunnelAction !== null || localTunnel?.state !== "running"}
                          className="terminal-btn text-xs px-3 py-1.5"
                        >
                          {localTunnelAction === "stop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Square className="w-3.5 h-3.5" /> Stop Tunnel</>}
                        </button>
                        <button
                          onClick={useTunnelUrl}
                          disabled={!localTunnel?.pushEndpoint}
                          className="terminal-btn text-xs px-3 py-1.5"
                        >
                          Use This URL
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        <p>No supported tunnel client is installed locally. Install one of these, then click `Refresh Tunnel`:</p>
                        <p className="font-mono" style={{ color: "var(--text-primary)" }}>brew install cloudflared</p>
                        <p className="font-mono" style={{ color: "var(--text-primary)" }}>brew install ngrok/ngrok/ngrok</p>
                      </div>
                    )}

                    {localTunnel?.pushEndpoint && (
                      <div className="space-y-2">
                        <div className="border p-3 text-xs font-mono" style={{ borderColor: "var(--border-dim)", background: "#05070d", color: "var(--text-primary)" }}>
                          {localTunnel.pushEndpoint}
                        </div>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          `Use This URL` fills the Push Endpoint and Push Audience fields above. Click `Save Trace Source` after that.
                        </p>
                      </div>
                    )}

                    {localTunnel?.logs?.length ? (
                      <details className="border p-3" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.25)" }}>
                        <summary className="cursor-pointer text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                          Tunnel Logs
                        </summary>
                        <pre className="mt-3 overflow-auto text-[10px] leading-5 whitespace-pre-wrap font-mono" style={{ color: "var(--text-primary)", maxHeight: 180 }}>
                          {localTunnel.logs.join("\n")}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={saveGcpTraceSource}
                    disabled={
                      gcpTraceSaving
                      || (gcpTraceSource.mode === "streaming" && (
                        !gcpTraceSource.projectId.trim()
                        || Boolean(validateStreamingPushEndpoint(gcpTraceSource.pushEndpoint))
                      ))
                    }
                    className="terminal-btn text-xs px-3 py-1.5"
                  >
                    {gcpTraceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Trace Source"}
                  </button>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {gcpTraceSource.mode === "streaming"
                      ? "Save first, then generate Terraform and apply it in your infra repo."
                      : "Save to keep Cloud Logging polling as the active trace source."}
                  </span>
                </div>

                {gcpTraceError && (
                  <p className="text-xs font-mono text-red-400">{gcpTraceError}</p>
                )}

                {gcpTraceBundle && gcpTraceSource.mode === "streaming" && (
                  <div className="space-y-4">
                    <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.3)" }}>
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>Apply Steps</h3>
                        <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {gcpTraceBundle.steps.map((step, index) => (
                            <p key={index}>{index + 1}. {step}</p>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        {gcpTraceBundle.notes.map((note, index) => (
                          <p key={index}>- {note}</p>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {gcpTraceBundle.files.map((file) => (
                        <div key={file.name} className="border p-4 space-y-3" style={{ borderColor: "var(--border-dim)", background: "rgba(2, 6, 23, 0.3)" }}>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-strong)" }}>{file.name}</p>
                              <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{file.language}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => copyGeneratedFile(file)} className="terminal-btn text-xs px-3 py-1.5">
                                {copiedFileName === file.name ? "Copied" : "Copy"}
                              </button>
                              <button onClick={() => downloadGeneratedFile(file)} className="terminal-btn text-xs px-3 py-1.5">
                                Download
                              </button>
                            </div>
                          </div>
                          <pre className="overflow-auto border p-3 text-[10px] leading-5 font-mono whitespace-pre-wrap" style={{ borderColor: "var(--border-dim)", color: "var(--text-primary)", background: "#05070d", maxHeight: 260 }}>
                            {file.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>
        </div>
      )}

      {/* Alerts Block */}
      {activeTab === "alerts" && (
        <div className="space-y-6 mt-6">
          {!isDemoUser ? (
            <>
              {/* ── Section: Slack Connection ─────────────────────────────── */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
                  Slack Connection
                </h2>
                <p className="text-xs" style={{ color: "var(--border-dim)" }}>
                  Connect a Slack bot to post alerts to your workspace.
                </p>
              </div>

              {/* Slack card */}
              <div className="overflow-hidden" style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)" }}>
                {/* Card header stripe */}
                <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border-dim)", background: "rgba(74,144,226,0.06)" }}>
                  <div className="w-6 h-6 rounded flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: "rgba(74,144,226,0.15)", color: "#4A90E2" }}>
                    S
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold" style={{ color: "var(--text-strong)" }}>Slack</p>
                    <p className="text-[10px] uppercase tracking-wider truncate" style={{ color: "var(--border-dim)" }}>
                      {alertSlackToken && alertSlackChannel
                        ? `Connected · #${alertSlackChannel}`
                        : "Not configured"}
                    </p>
                  </div>
                  {alertSlackToken && alertSlackChannel && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ background: "rgba(16,185,129,0.12)", color: "var(--green)", border: "1px solid rgba(16,185,129,0.25)" }}>
                      Active
                    </span>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {/* Bot Token */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                      Bot Token
                    </label>
                    <div className="relative">
                      <input
                        type={showSlackToken ? "text" : "password"}
                        value={alertSlackToken}
                        onChange={(e) => setAlertSlackToken(e.target.value)}
                        placeholder="xoxb-..."
                        className="w-full px-3 py-2 bg-transparent text-xs placeholder:opacity-30 outline-none font-mono pr-8"
                        style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSlackToken((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity opacity-40 hover:opacity-80"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {showSlackToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--border-dim)" }}>
                      api.slack.com/apps → OAuth &amp; Permissions → Bot User OAuth Token
                    </p>
                  </div>

                  {/* Channel ID */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                      Channel ID
                    </label>
                    <input
                      type="text"
                      value={alertSlackChannel}
                      onChange={(e) => setAlertSlackChannel(e.target.value)}
                      placeholder="C08XXXXXXXXX"
                      className="w-full px-3 py-2 bg-transparent text-xs placeholder:opacity-30 outline-none font-mono"
                      style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    />
                    <p className="text-[10px]" style={{ color: "var(--border-dim)" }}>
                      Right-click the channel in Slack → View channel details → scroll to Channel ID
                    </p>
                  </div>

                  {/* Webhook fallback (collapsed visually) */}
                  <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: "var(--border-dim)" }}>
                    <label className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--border-dim)" }}>
                      Webhook URL <span className="normal-case font-normal opacity-60">— alternative to bot token</span>
                    </label>
                    <input
                      type="url"
                      value={alertWebhook}
                      onChange={(e) => setAlertWebhook(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full px-3 py-2 bg-transparent text-xs placeholder:opacity-20 outline-none font-mono"
                      style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
                    />
                  </div>

                  {/* Test + Save row */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={testWebhook}
                      disabled={!(alertSlackToken.trim() && alertSlackChannel.trim()) && !alertWebhook.trim() || alertTesting}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        ((alertSlackToken.trim() && alertSlackChannel.trim()) || alertWebhook.trim()) && !alertTesting
                          ? { border: "1px solid var(--border-dim)", color: "var(--text-muted)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--border-dim)", opacity: 0.4 }
                      }
                    >
                      {alertTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : alertTestResult === "ok" ? <Check className="w-3 h-3 text-green-400" /> : <Send className="w-3 h-3" />}
                      {alertTesting ? "Sending…" : alertTestResult === "ok" ? "Sent!" : "Test"}
                    </button>
                    <button
                      onClick={saveAlertRules}
                      disabled={alertSaving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                      style={
                        !alertSaving
                          ? { background: "var(--green)", color: "var(--bg)" }
                          : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5 }
                      }
                    >
                      {alertSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : alertSaved ? <Check className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                      {alertSaving ? "Saving…" : alertSaved ? "Saved!" : "Save"}
                    </button>
                    {alertError && (
                      <p className="text-xs text-red-400 font-mono ml-1">{alertError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section: Trigger Rules ────────────────────────────────── */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
                  Trigger Rules
                </h2>
                <p className="text-xs" style={{ color: "var(--border-dim)" }}>
                  Which severities fire an alert when new findings appear on the next scan.
                </p>
              </div>

              <div className="flex gap-3">
                {([
                  { key: "critical" as const, label: "Critical", checked: alertOnCritical, onChange: setAlertOnCritical, activeColor: "rgba(239,68,68,0.15)", activeBorder: "rgba(239,68,68,0.4)", activeText: "#f87171" },
                  { key: "high" as const, label: "High", checked: alertOnHigh, onChange: setAlertOnHigh, activeColor: "rgba(249,115,22,0.15)", activeBorder: "rgba(249,115,22,0.4)", activeText: "#fb923c" },
                ]).map((rule) => (
                  <button
                    key={rule.key}
                    onClick={() => rule.onChange(!rule.checked)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all duration-150"
                    style={
                      rule.checked
                        ? { background: rule.activeColor, border: `1px solid ${rule.activeBorder}`, color: rule.activeText }
                        : { border: "1px solid var(--border-dim)", color: "var(--border-dim)" }
                    }
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: rule.checked ? rule.activeText : "var(--border-dim)" }} />
                    {rule.label}
                  </button>
                ))}
              </div>

              {/* ── Section: Simulate Alert ───────────────────────────────── */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
                  Simulate Alert
                </h2>
                <p className="text-xs" style={{ color: "var(--border-dim)" }}>
                  Fire a labelled test alert with any combination of finding types to verify your integration.
                </p>
              </div>

              <div className="p-4 space-y-5" style={{ border: "1px solid var(--border-dim)", background: "var(--bg-card)" }}>
                {(
                  [
                    {
                      label: "Critical", dot: "#f87171", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)",
                      findings: [
                        { id: "public_bucket", label: "Public Storage Bucket" },
                        { id: "public_firewall", label: "Firewall Open to Internet" },
                        { id: "secret_in_env", label: "Secret in Cloud Run Env Var" },
                      ],
                    },
                    {
                      label: "High", dot: "#fb923c", bg: "rgba(249,115,22,0.08)", border: "rgba(249,115,22,0.2)",
                      findings: [
                        { id: "expired_sa_key", label: "Expired SA Key" },
                        { id: "sa_owner_editor", label: "SA with Owner/Editor Role" },
                        { id: "user_owner_editor", label: "User Owner on Multiple Projects" },
                        { id: "secret_public", label: "Public Secret" },
                      ],
                    },
                    {
                      label: "Medium", dot: "#facc15", bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.2)",
                      findings: [
                        { id: "vm_external_ip_no_sa", label: "VM External IP / No SA" },
                        { id: "multiple_sa_keys", label: "Multiple SA Keys" },
                        { id: "sql_public_ip", label: "SQL Public IP" },
                        { id: "cloud_run_public", label: "Cloud Run Public" },
                      ],
                    },
                    {
                      label: "Low", dot: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.2)",
                      findings: [
                        { id: "orphaned_sa", label: "Orphaned SA in IAM" },
                        { id: "sa_not_in_list", label: "Unknown SA in Bindings" },
                      ],
                    },
                  ] as { label: string; dot: string; bg: string; border: string; findings: { id: string; label: string }[] }[]
                ).map((group) => (
                  <div key={group.label} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: group.dot }} />
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: group.dot }}>{group.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.findings.map((f) => {
                        const on = simSelected.includes(f.id);
                        return (
                          <button
                            key={f.id}
                            onClick={() =>
                              setSimSelected((prev) =>
                                on ? prev.filter((x) => x !== f.id) : [...prev, f.id]
                              )
                            }
                            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-all duration-100"
                            style={
                              on
                                ? { background: group.bg, border: `1px solid ${group.border}`, color: group.dot }
                                : { border: "1px solid var(--border-dim)", color: "var(--border-dim)" }
                            }
                          >
                            {on && <Check className="w-2.5 h-2.5 shrink-0" />}
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {simError && (
                  <p className="text-xs text-red-400 font-mono">{simError}</p>
                )}

                <div className="flex items-center gap-3 pt-1 border-t" style={{ borderColor: "var(--border-dim)" }}>
                  <button
                    onClick={sendSimulation}
                    disabled={simSelected.length === 0 || simSending}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all duration-150"
                    style={
                      simSelected.length > 0 && !simSending
                        ? { background: "var(--green)", color: "var(--bg)" }
                        : { border: "1px solid var(--border-dim)", color: "var(--border-dim)", opacity: 0.4 }
                    }
                  >
                    {simSending ? <Loader2 className="w-3 h-3 animate-spin" /> : simResult === "ok" ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                    {simSending ? "Sending…" : simResult === "ok" ? "Sent!" : `Send${simSelected.length > 0 ? ` (${simSelected.length})` : ""}`}
                  </button>
                  {simSelected.length > 0 && (
                    <button
                      onClick={() => setSimSelected([])}
                      className="text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
                      style={{ color: "var(--border-dim)" }}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Alert notifications are disabled for demo accounts.
            </p>
          )}
        </div>
      )}

      {/* Diagnostics Block */}
      {activeTab === "diagnostics" && (
        <div className="space-y-8 mt-6">
          {errorLog.length > 0 ? (
            <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
              <AlertCircle className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
              Error Log ({errorLog.length})
            </h2>
            <button onClick={() => setErrorLog([])} className="text-xs hover:text-white flex items-center gap-1 transition-colors" style={{ color: "var(--text-muted)" }}>
              <X className="w-3 h-3" /> Clear
            </button>
          </div>
          <div className="border overflow-hidden" style={{ borderColor: "rgba(239, 68, 68, 0.2)", background: "rgba(239, 68, 68, 0.05)" }}>
            <div className="max-h-64 overflow-y-auto">
              {errorLog.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5 border-b last:border-0" style={{ borderColor: "rgba(239, 68, 68, 0.1)" }}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold uppercase" style={{ color: "var(--red)" }}>{entry.provider}</span>
                    <span className="text-xs font-mono" style={{ color: "var(--border-dim)" }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs font-mono break-all" style={{ color: "var(--text-primary)" }}>{entry.message}</p>
                </div>
              ))}
            </div>
          </div>
            </div>
          ) : (
            <p className="text-xs relative" style={{ color: "var(--text-muted)" }}>
              No diagnostics logs available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
