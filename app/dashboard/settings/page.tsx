"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Trash2, Check, Loader2, AlertCircle, CheckCircle2, Star, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIProvider, AIKeyRecord } from "@/lib/ai/client";

interface CloudCredRecord {
  provider: string;
  createdAt: string;
  updatedAt: string;
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

export default function SettingsPage() {
  const [keys, setKeys] = useState<AIKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState<Record<AIProvider, string>>({ google: "", openai: "", anthropic: "" });
  const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [saving, setSaving] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [deleting, setDeleting] = useState<Record<AIProvider, boolean>>({ google: false, openai: false, anthropic: false });
  const [activating, setActivating] = useState<AIProvider | null>(null);
  const [errorLog, setErrorLog] = useState<ErrorEntry[]>([]);

  // Cloud credentials state
  const [cloudCreds, setCloudCreds] = useState<CloudCredRecord[]>([]);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [gcpKeyInput, setGcpKeyInput] = useState("");
  const [awsInputs, setAwsInputs] = useState({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
  const [showAwsSecret, setShowAwsSecret] = useState(false);
  const [cloudSaving, setCloudSaving] = useState<Record<string, boolean>>({ gcp: false, aws: false });
  const [cloudDeleting, setCloudDeleting] = useState<Record<string, boolean>>({ gcp: false, aws: false });
  const [cloudErrors, setCloudErrors] = useState<Record<string, string>>({ gcp: "", aws: "" });

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d) => {
        setKeys(d.keys ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((d) => setCloudCreds(d.credentials ?? []))
      .catch(() => {})
      .finally(() => setCloudLoading(false));
  }, []);

  function addError(provider: string, message: string) {
    setErrorLog((prev) => [
      { id: crypto.randomUUID(), timestamp: new Date().toISOString(), provider, message },
      ...prev.slice(0, 19),
    ]);
  }

  async function saveKey(provider: AIProvider) {
    const apiKey = inputs[provider].trim();
    if (!apiKey) return;
    setSaving((s) => ({ ...s, [provider]: true }));
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        addError(provider, data.error ?? "Unknown error");
        return;
      }
      setKeys(data.keys);
      setInputs((i) => ({ ...i, [provider]: "" }));
    } catch (e) {
      addError(provider, e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving((s) => ({ ...s, [provider]: false }));
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

  async function setActive(provider: AIProvider) {
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

  async function saveCloudCred(provider: "gcp" | "aws") {
    setCloudSaving((s) => ({ ...s, [provider]: true }));
    setCloudErrors((e) => ({ ...e, [provider]: "" }));
    try {
      const credentials =
        provider === "gcp"
          ? { serviceAccountKey: gcpKeyInput.trim() }
          : {
              accessKeyId: awsInputs.accessKeyId.trim(),
              secretAccessKey: awsInputs.secretAccessKey.trim(),
              region: awsInputs.region.trim() || "us-east-1",
            };
      const res = await fetch("/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloudErrors((e) => ({ ...e, [provider]: data.error ?? "Unknown error" }));
        return;
      }
      setCloudCreds(data.credentials);
      if (provider === "gcp") setGcpKeyInput("");
      else setAwsInputs({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
    } catch (e) {
      setCloudErrors((err) => ({ ...err, [provider]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setCloudSaving((s) => ({ ...s, [provider]: false }));
    }
  }

  async function deleteCloudCred(provider: "gcp" | "aws") {
    setCloudDeleting((d) => ({ ...d, [provider]: true }));
    try {
      const res = await fetch(`/api/settings/credentials/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setCloudErrors((e) => ({ ...e, [provider]: data.error ?? "Delete failed" }));
        return;
      }
      setCloudCreds(data.credentials);
    } catch (e) {
      setCloudErrors((err) => ({ ...err, [provider]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setCloudDeleting((d) => ({ ...d, [provider]: false }));
    }
  }

  const hasAnyKey = keys.length > 0;
  const activeKey = keys.find((k) => k.isActive);

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-white">Settings</h1>
      </div>

      {/* No-key notice */}
      {!loading && !hasAnyKey && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/8">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">No AI keys configured</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              Advanced features (AI security recommendations, natural language queries) are using the system default key. Add your own key below to use your preferred provider and quota.
            </p>
          </div>
        </div>
      )}

      {/* Active key summary */}
      {activeKey && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            Active provider: <span className="font-semibold">{PROVIDERS.find((p) => p.id === activeKey.provider)?.name}</span>
            <span className="ml-2 font-mono text-emerald-400/70">····{activeKey.keyHint}</span>
          </p>
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-4">
        <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider">AI Provider Keys</h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass rounded-xl p-5 animate-pulse h-32" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {PROVIDERS.map((prov) => {
              const record = keys.find((k) => k.provider === prov.id);
              const isSaving = saving[prov.id];
              const isDeleting = deleting[prov.id];
              const isActivating = activating === prov.id;
              const isActive = record?.isActive;

              return (
                <div
                  key={prov.id}
                  className={cn(
                    "rounded-xl border p-5 space-y-4 transition-all duration-150",
                    prov.bg, prov.border,
                    isActive && "ring-1 ring-emerald-500/30"
                  )}
                >
                  {/* Card header */}
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
                        <p className="text-xs text-slate-500 mt-0.5">{prov.description}</p>
                        <p className="text-xs text-slate-600 font-mono mt-0.5">Model: {prov.models}</p>
                      </div>
                    </div>

                    {/* Status */}
                    {record ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check className="w-3 h-3" />
                          <span className="font-mono">····{record.keyHint}</span>
                        </span>
                        {!isActive && keys.length > 1 && (
                          <button
                            onClick={() => setActive(prov.id)}
                            disabled={isActivating}
                            className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500"
                          >
                            {isActivating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set active"}
                          </button>
                        )}
                        <button
                          onClick={() => deleteKey(prov.id)}
                          disabled={isDeleting}
                          className="text-slate-600 hover:text-red-400 transition-colors"
                          title="Remove key"
                        >
                          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600 shrink-0">Not configured</span>
                    )}
                  </div>

                  {/* Key input */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey[prov.id] ? "text" : "password"}
                        value={inputs[prov.id]}
                        onChange={(e) => setInputs((i) => ({ ...i, [prov.id]: e.target.value }))}
                        placeholder={record ? `Update key (${prov.placeholder})` : `Paste API key (${prov.placeholder})`}
                        className="w-full pl-3 pr-9 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono text-xs"
                        onKeyDown={(e) => e.key === "Enter" && saveKey(prov.id)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => ({ ...s, [prov.id]: !s[prov.id] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showKey[prov.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      onClick={() => saveKey(prov.id)}
                      disabled={!inputs[prov.id].trim() || isSaving}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                        inputs[prov.id].trim() && !isSaving
                          ? cn(prov.accent, "text-white hover:opacity-90")
                          : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                      )}
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSaving ? "Testing…" : record ? "Update" : "Add & Test"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">
                    Key is tested before saving and stored encrypted. Never shared with third parties.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cloud Credentials */}
      <div className="space-y-4">
        <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider">Cloud Credentials</h2>
        {cloudLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="glass rounded-xl p-5 animate-pulse h-40" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {/* GCP Card */}
            {(() => {
              const record = cloudCreds.find((c) => c.provider === "gcp");
              const isSaving = cloudSaving.gcp;
              const isDeleting = cloudDeleting.gcp;
              const error = cloudErrors.gcp;
              return (
                <div className="rounded-xl border p-5 space-y-4 transition-all duration-150 bg-blue-500/8 border-blue-500/25">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0 bg-blue-500">G</div>
                      <div>
                        <span className="text-sm font-semibold text-blue-400">Google Cloud Platform</span>
                        <p className="text-xs text-slate-500 mt-0.5">Service account key for GCP scanning</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button
                            onClick={() => deleteCloudCred("gcp")}
                            disabled={isDeleting}
                            className="text-slate-600 hover:text-red-400 transition-colors"
                            title="Remove credentials"
                          >
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
                        gcpKeyInput.trim() && !isSaving
                          ? "bg-blue-500 text-white hover:opacity-90"
                          : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
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
                <div className="rounded-xl border p-5 space-y-4 transition-all duration-150 bg-orange-500/8 border-orange-500/25">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0 bg-orange-500">A</div>
                      <div>
                        <span className="text-sm font-semibold text-orange-400">Amazon Web Services</span>
                        <p className="text-xs text-slate-500 mt-0.5">IAM access keys for AWS scanning</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {record ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <Check className="w-3 h-3" /> Connected
                          </span>
                          <button
                            onClick={() => deleteCloudCred("aws")}
                            disabled={isDeleting}
                            className="text-slate-600 hover:text-red-400 transition-colors"
                            title="Remove credentials"
                          >
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">Not configured</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={awsInputs.accessKeyId}
                      onChange={(e) => setAwsInputs((i) => ({ ...i, accessKeyId: e.target.value }))}
                      placeholder={record ? "New Access Key ID (leave blank to keep existing)" : "Access Key ID (AKIA...)"}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono"
                    />
                    <div className="relative">
                      <input
                        type={showAwsSecret ? "text" : "password"}
                        value={awsInputs.secretAccessKey}
                        onChange={(e) => setAwsInputs((i) => ({ ...i, secretAccessKey: e.target.value }))}
                        placeholder="Secret Access Key"
                        className="w-full pl-3 pr-9 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAwsSecret((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showAwsSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={awsInputs.region}
                      onChange={(e) => setAwsInputs((i) => ({ ...i, region: e.target.value }))}
                      placeholder="Region (default: us-east-1)"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/50 font-mono"
                    />
                    {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
                    <button
                      onClick={() => saveCloudCred("aws")}
                      disabled={(!awsInputs.accessKeyId.trim() || !awsInputs.secretAccessKey.trim()) || isSaving}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                        (awsInputs.accessKeyId.trim() && awsInputs.secretAccessKey.trim()) && !isSaving
                          ? "bg-orange-500 text-white hover:opacity-90"
                          : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                      )}
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

      {/* Error log */}
      {errorLog.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-slate-500 font-medium uppercase tracking-wider flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              Provider Error Log ({errorLog.length})
            </h2>
            <button
              onClick={() => setErrorLog([])}
              className="text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              {errorLog.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5 border-b border-red-500/10 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-red-400 uppercase">{entry.provider}</span>
                    <span className="text-xs text-slate-600 font-mono">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-red-300/80 font-mono break-all">{entry.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
