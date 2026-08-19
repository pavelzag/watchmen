"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ClusterRecord = {
  id: string;
  name: string;
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
  kubeconfigFilename?: string;
  hasKubeconfig?: boolean;
};

type ClusterStatus = {
  ok: boolean;
  enabled: boolean;
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
};

export default function SelfManagedClusterCard({
  cluster: initial,
  onDelete,
  onRenamed,
}: {
  cluster: ClusterRecord & { status?: ClusterStatus | null };
  onDelete: () => void;
  onRenamed: () => void;
}) {
  const [cluster, setCluster] = useState(initial);
  const [status, setStatus] = useState<ClusterStatus | null>(initial.status ?? null);
  const [paste, setPaste] = useState("");
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testPhase, setTestPhase] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState(cluster.name);
  const [contextEdit, setContextEdit] = useState(cluster.context);
  const [namespaceEdit, setNamespaceEdit] = useState(cluster.namespace);
  const [enabledEdit, setEnabledEdit] = useState(cluster.enabled);
  const [pathEdit, setPathEdit] = useState(cluster.kubeconfigPath);
  const [deletingKube, setDeletingKube] = useState(false);

  useEffect(() => {
    setCluster(initial);
    setNameEdit(initial.name);
    setContextEdit(initial.context);
    setNamespaceEdit(initial.namespace);
    setEnabledEdit(initial.enabled);
    setPathEdit(initial.kubeconfigPath);
    if (initial.status) setStatus(initial.status);
  }, [initial]);

  useEffect(() => {
    fetch(`/api/kubernetes/clusters/${cluster.id}/status`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.status) setStatus(d.status);
        if (d.cluster) {
          setCluster((c) => ({ ...c, ...d.cluster, hasKubeconfig: d.hasKubeconfig ?? d.status?.hasKubeconfig }));
          setContextEdit(d.cluster.context ?? "");
        }
      })
      .catch(() => {});
  }, [cluster.id]);

  async function uploadFile(file: File) {
    if (file.size > 500 * 1024) {
      setError("File too large — max 500 KB.");
      return;
    }
    setUploading(true);
    setError(null);
    setTestPhase("idle");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/kubernetes/clusters/${cluster.id}/kubeconfig`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ? `${data.error} (HTTP ${res.status})` : `Failed to upload kubeconfig (HTTP ${res.status})`);
        return;
      }
      if (data.context) setContextEdit(data.context);
      if (data.status) setStatus(data.status);
      setCluster((c) => ({ ...c, hasKubeconfig: true, kubeconfigFilename: data.kubeconfigFilename ?? file.name }));
      // Auto-derive cluster name from kubeconfig if current name is generic
      try {
        const derivedFromStatus = data.status?.clusterName || data.contexts?.[0]?.cluster;
        const shouldRename = cluster.name === "default" || /^cluster-[a-z0-9]+$/i.test(cluster.name) || cluster.name.trim().length < 2;
        if (derivedFromStatus && shouldRename && derivedFromStatus !== cluster.name) {
          const clean = String(derivedFromStatus).replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
          if (clean && clean.length >= 2) {
            setNameEdit(clean);
            fetch(`/api/kubernetes/clusters/${cluster.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: clean }),
            }).catch(() => {});
          }
        }
      } catch {}
      // If file was a merged kubeconfig (multiple contexts), create additional clusters for remaining contexts
      try {
        const text = await file.text().catch(() => "");
        if (text && text.includes("contexts:") && (data.contexts?.length ?? 0) > 1) {
          // Use contexts from server response if available, else parse
          const remaining = (data.contexts as Array<{ name: string; cluster: string; namespace?: string }> | undefined)?.filter((c) => c.name !== data.context) ?? [];
          if (remaining.length > 0) {
            let existingNames = new Set<string>();
            try {
              const lr = await fetch("/api/kubernetes/clusters", { cache: "no-store" });
              const ld = await lr.json();
              if (Array.isArray(ld.clusters)) existingNames = new Set(ld.clusters.map((c: { name: string }) => c.name));
            } catch {}
            const sanitize = (s: string) => s.replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || s.slice(0, 64);
            let created = 0;
            const unreachableNames: string[] = [];
            for (const ctx of remaining) {
              const base = ctx.cluster || ctx.name;
              let derived = sanitize(base) || sanitize(ctx.name) || `cluster-${Date.now().toString(36)}`;
              let candidate = derived;
              let suffix = 1;
              while (existingNames.has(candidate) && suffix < 20) {
                suffix += 1;
                candidate = `${derived}-${suffix}`.slice(0, 64);
              }
              existingNames.add(candidate);
              const cr = await fetch("/api/kubernetes/clusters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: candidate, enabled: true, kubeconfigContent: text, kubeconfigFilename: file.name, context: ctx.name, namespace: ctx.namespace ?? "watchmen" }),
              });
              const cd = await cr.json().catch(() => ({} as { error?: string; code?: string }));
              if (cr.ok) created += 1;
              else if (cd.code === "unreachable" || /unreachable/i.test(cd.error ?? "")) unreachableNames.push(candidate);
            }
            if (created > 0 || unreachableNames.length > 0) {
              const parts: string[] = [];
              if (created > 0) parts.push(`Uploaded merged kubeconfig: updated this cluster + created ${created} additional cluster(s).`);
              if (unreachableNames.length) parts.push(`Skipped ${unreachableNames.length} unreachable (not added): ${unreachableNames.join(", ")}`);
              if (parts.length) setError(parts.join(" "));
              if (created > 0) setTimeout(() => { try { onRenamed(); } catch {} }, 300);
            }
          }
        }
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload");
    } finally {
      setUploading(false);
    }
  }

  async function uploadPaste() {
    const trimmed = paste.trim();
    if (!trimmed) {
      setError("Paste a kubeconfig YAML first.");
      return;
    }
    if (trimmed.length > 500 * 1024) {
      setError("Pasted content too large — max 500 KB.");
      return;
    }
    if (!trimmed.includes("apiVersion:") || !trimmed.includes("clusters:") || !trimmed.includes("contexts:")) {
      setError("Paste does not look like a kubeconfig — expected apiVersion, clusters, contexts.");
      return;
    }
    setUploading(true);
    setError(null);
    setTestPhase("idle");
    try {
      const res = await fetch(`/api/kubernetes/clusters/${cluster.id}/kubeconfig`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kubeconfig: trimmed, filename: "pasted-kubeconfig.yaml" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ? `${data.error} (HTTP ${res.status})` : `Failed to save kubeconfig (HTTP ${res.status})`);
        return;
      }
      if (data.context) setContextEdit(data.context);
      if (data.status) setStatus(data.status);
      setCluster((c) => ({ ...c, hasKubeconfig: true, kubeconfigFilename: data.kubeconfigFilename ?? "pasted-kubeconfig.yaml" }));
      setPaste("");
      // If pasted content is a merged kubeconfig (multiple contexts), offer to create the other clusters as separate entries
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
        if (n && !seen.has(n) && n !== data.context) {
          seen.add(n);
          contextEntries.push({ name: n, cluster: c, namespace: m[3]?.replace(/["']/g, "").trim() });
        }
        if (contextEntries.length >= 19) break;
      }
      if (contextEntries.length > 0) {
        // Fetch existing cluster names to de-duplicate
        let existingNames = new Set<string>();
        try {
          const listRes = await fetch("/api/kubernetes/clusters", { cache: "no-store" });
          const listData = await listRes.json();
          if (Array.isArray(listData.clusters)) existingNames = new Set(listData.clusters.map((c: { name: string }) => c.name));
        } catch {}
        const sanitize = (s: string) => s.replace(/[^a-z0-9-_\.]/gi, "-").slice(0, 64).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") || s.slice(0, 64);
        let created = 0;
        let lastError: string | null = null;
        const unreachableNames: string[] = [];
        const otherErrors: string[] = [];
        for (const ctx of contextEntries) {
          const base = ctx.cluster || ctx.name;
          let derived = sanitize(base) || sanitize(ctx.name) || `cluster-${Date.now().toString(36)}`;
          let candidate = derived;
          let suffix = 1;
          while (existingNames.has(candidate) && suffix < 20) {
            suffix += 1;
            candidate = `${derived}-${suffix}`.slice(0, 64);
          }
          existingNames.add(candidate);
          const cr = await fetch("/api/kubernetes/clusters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: candidate, enabled: true, kubeconfigContent: trimmed, kubeconfigFilename: "pasted-kubeconfig.yaml", context: ctx.name, namespace: ctx.namespace ?? "watchmen" }),
          });
          const cd = await cr.json().catch(() => ({} as { error?: string; code?: string }));
          if (!cr.ok) {
            const errMsg = cd.error ?? `Failed for ${candidate}`;
            if (cd.code === "unreachable" || /unreachable/i.test(errMsg)) unreachableNames.push(candidate);
            else otherErrors.push(errMsg);
            lastError = errMsg;
          } else created += 1;
        }
        if (created > 0 || unreachableNames.length || otherErrors.length) {
          const parts: string[] = [];
          if (created > 0) parts.push(`Pasted merged kubeconfig: updated this cluster + created ${created} additional cluster(s).`);
          if (unreachableNames.length) parts.push(`Skipped ${unreachableNames.length} unreachable (not added): ${unreachableNames.join(", ")}`);
          if (otherErrors.length) parts.push(`Errors: ${otherErrors.slice(0, 3).join(" | ")}`);
          else if (lastError && !unreachableNames.length && !otherErrors.length) parts.push(`Last error: ${lastError}`);
          if (parts.length) setError(parts.join(" "));
          // Refresh parent list via onRenamed which triggers refreshClusters
          if (created > 0) setTimeout(() => { try { onRenamed(); } catch {} }, 300);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      setError(msg.includes("fetch") ? `${msg} — check network and that the kubeconfig is valid YAML under 500KB` : msg);
    } finally {
      setUploading(false);
    }
  }

  async function removeKubeconfig() {
    setDeletingKube(true);
    setError(null);
    try {
      const res = await fetch(`/api/kubernetes/clusters/${cluster.id}/kubeconfig`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove");
        return;
      }
      setCluster((c) => ({ ...c, hasKubeconfig: false, kubeconfigFilename: undefined }));
      if (data.status) setStatus(data.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setDeletingKube(false);
    }
  }

  async function test(save: boolean) {
    if (save) setSaving(true);
    else setTesting(true);
    setTestPhase("testing");
    setError(null);
    try {
      const res = await fetch(`/api/kubernetes/clusters/${cluster.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameEdit,
          enabled: enabledEdit,
          kubeconfigPath: pathEdit,
          context: contextEdit,
          namespace: namespaceEdit,
          save,
        }),
      });
      const data = await res.json();
      if (data.status) setStatus(data.status);
      if (data.cluster) {
        setCluster((c) => ({ ...c, ...data.cluster, hasKubeconfig: data.hasKubeconfig ?? data.status?.hasKubeconfig }));
        setNameEdit(data.cluster.name ?? nameEdit);
      }
      if (!res.ok) {
        setError(data.status?.error ?? data.error ?? "Connection failed.");
        setTestPhase("error");
      } else if (data.status?.ok) {
        setTestPhase("success");
        if (save) onRenamed();
      } else {
        setTestPhase("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setTestPhase("error");
    } finally {
      setTesting(false);
      setSaving(false);
    }
  }

  async function handleDeleteCluster() {
    if (!confirm(`Delete cluster "${cluster.name}"? This will remove its kubeconfig and settings.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/kubernetes/clusters/${cluster.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to delete");
        return;
      }
      onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  const hasKube = Boolean(status?.hasKubeconfig ?? cluster.hasKubeconfig);

  return (
    <div className="border p-4 space-y-4" style={{ borderColor: hasKube ? "rgba(16,185,129,0.25)" : "var(--border-dim)", background: "rgba(2, 6, 23, 0.35)" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} placeholder="cluster-name" className="px-2 py-1 bg-slate-900/60 border text-sm font-bold font-mono" style={{ borderColor: "var(--border-dim)", color: "var(--text-primary)", minWidth: 140 }} />
            {status?.distribution && status?.ok && <span className="px-2 py-0.5 border text-[10px] uppercase tracking-widest bg-sky-500/10 text-sky-400" style={{ borderColor: "rgba(14,165,233,0.25)" }}>{status.distribution}</span>}
            <span className={cn("px-2 py-0.5 border text-[10px] uppercase tracking-widest", status?.ok ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/10" : enabledEdit ? "text-amber-400 border-amber-500/25 bg-amber-500/10" : "text-slate-400 border-slate-600/30 bg-slate-700/20")}>
              {status?.ok ? "Connected" : enabledEdit ? "Needs Check" : "Disabled"}
            </span>
            {hasKube && <span className="px-2 py-0.5 border text-[10px] font-mono bg-slate-800/60 text-slate-300" style={{ borderColor: "var(--border-dim)" }}>{cluster.kubeconfigFilename ?? status?.kubeconfigFilename ?? "kubeconfig"} · {status?.contexts?.length ?? 0} contexts</span>}
          </div>
          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            {status?.ok ? `${status.clusterName} · ${status.kubernetesVersion}${status.distribution ? ` · ${status.distribution}` : ""} · ${status.serverUrl}` : status?.error ?? "Upload kubeconfig, pick context, Test & Save."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-primary)" }}>
            <input type="checkbox" checked={enabledEdit} onChange={(e) => { setEnabledEdit(e.target.checked); setTestPhase("idle"); }} /> Enable
          </label>
          <button onClick={handleDeleteCluster} disabled={deleting} className="terminal-btn text-xs px-2 py-1 inline-flex items-center gap-1 opacity-60 hover:opacity-100">
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Delete
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        <span className={cn("px-2 py-0.5 border", hasKube ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-slate-800 border-slate-700")}>1 Upload</span>
        <span>→</span>
        <span className={cn("px-2 py-0.5 border", status?.contexts?.length ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : contextEdit ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-slate-800 border-slate-700")}>2 Configure</span>
        <span>→</span>
        <span className={cn("px-2 py-0.5 border", testPhase === "success" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : testPhase === "testing" ? "bg-sky-500/10 border-sky-500/25 text-sky-400" : "bg-slate-800 border-slate-700")}>3 Test & Save</span>
      </div>

      {/* Upload tabs */}
      <div className="border" style={{ borderColor: "var(--border-dim)", background: "rgba(15, 23, 42, 0.25)" }}>
        <div className="flex gap-0 border-b" style={{ borderColor: "var(--border-dim)" }}>
          <button onClick={() => setTab("upload")} className={cn("flex-1 px-3 py-2 text-xs font-bold uppercase tracking-widest", tab === "upload" ? "bg-slate-800 text-white" : "text-slate-400")} style={{ borderRight: "1px solid var(--border-dim)" }}>
            <span className="inline-flex items-center gap-1.5"><Plus className="w-3 h-3" /> Upload File</span>
          </button>
          <button onClick={() => setTab("paste")} className={cn("flex-1 px-3 py-2 text-xs font-bold uppercase tracking-widest", tab === "paste" ? "bg-slate-800 text-white" : "text-slate-400")}>
            <span className="inline-flex items-center gap-1.5"><Send className="w-3 h-3" /> Paste YAML</span>
          </button>
          <button onClick={() => setShowHints((v) => !v)} className="px-3 py-2 text-xs underline shrink-0" style={{ color: "var(--text-muted)" }}>
            {showHints ? "Hide hints" : "Hints →"}
          </button>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="font-mono">k3s</span> · <span className="font-mono">k0s</span> · <span className="font-mono">microk8s</span> · <span className="font-mono">kind</span> · <span className="font-mono">minikube</span> · <span className="font-mono">talos</span> · <span className="font-mono">RKE2</span> · <span className="font-mono">kubectl config view --raw</span> · max 500 KB · encrypted
          </p>
          {tab === "upload" ? (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
                onClick={() => document.getElementById(`kube-file-${cluster.id}`)?.click()}
                className={cn("border-2 border-dashed p-6 text-center space-y-2 cursor-pointer", dragOver ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600")}
              >
                <div className="flex justify-center"><div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: dragOver ? "#10b981" : "#1e293b", color: "#fff" }}><Plus className="w-4 h-4" /></div></div>
                <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{dragOver ? "Drop kubeconfig here" : "Drop kubeconfig here or click to browse"}</p>
                <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>.yaml · .kubeconfig · txt</p>
                {hasKube && <p className="text-[11px] font-mono text-emerald-400">Current: {cluster.kubeconfigFilename ?? status?.kubeconfigFilename ?? "uploaded"} — dropping a new file will replace it</p>}
              </div>
              <input id={`kube-file-${cluster.id}`} type="file" accept=".yaml,.yml,.kubeconfig,.txt,*/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              <div className="flex gap-2 flex-wrap">
                <label htmlFor={`kube-file-${cluster.id}`} className={cn("terminal-btn text-xs px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5", uploading && "opacity-50 pointer-events-none")}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Browse
                </label>
                <button onClick={removeKubeconfig} disabled={!hasKube || deletingKube} className="terminal-btn text-xs px-3 py-1.5 disabled:opacity-40 inline-flex items-center gap-1">
                  {deletingKube ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove kubeconfig
                </button>
                {status?.contexts && <span className="text-xs font-mono self-center" style={{ color: "var(--text-muted)" }}>{status.contexts.length} contexts: {status.contexts.slice(0,3).map(c=>c.name).join(", ")}{status.contexts.length>3?"…":""}</span>}
              </div>
            </>
          ) : (
            <>
              <textarea value={paste} onChange={(e) => { setPaste(e.target.value); if (error) setError(null); }} placeholder="Paste kubeconfig YAML — apiVersion: v1, clusters:, users:, contexts:" rows={5} className="w-full px-3 py-2 bg-slate-900/60 border text-xs font-mono" style={{ border: paste && (!paste.includes("clusters:") || !paste.includes("contexts:")) ? "1px solid #f59e0b" : "1px solid var(--border-dim)", color: "var(--text-primary)" }} />
              <div className="flex gap-2 items-center flex-wrap">
                <button onClick={uploadPaste} disabled={!paste.trim() || uploading} className={cn("terminal-btn text-xs px-3 py-1.5 inline-flex items-center gap-1", (!paste.trim() || uploading) && "opacity-40 pointer-events-none")}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Upload pasted YAML
                </button>
                <span className="text-[11px] font-mono" style={{ color: paste.length > 500*1024 ? "#ef4444" : "var(--text-muted)" }}>{paste.length.toLocaleString()} chars · {paste ? Math.round(paste.length/1024)+" KB" : "0 KB"} / 500 KB</span>
              </div>
            </>
          )}
          {showHints && (
            <div className="grid gap-1 text-[11px] font-mono p-2 border" style={{ borderColor: "var(--border-dim)", background: "rgba(15,23,42,0.5)", color: "var(--text-muted)" }}>
              <div><span className="text-sky-400">k3s:</span> <span className="select-all">k3s kubectl config view --raw</span> or <span className="select-all">/etc/rancher/k3s/k3s.yaml</span></div>
              <div><span className="text-sky-400">k0s:</span> <span className="select-all">k0s kubeconfig admin &gt; kubeconfig.yaml</span></div>
              <div><span className="text-sky-400">microk8s:</span> <span className="select-all">microk8s config &gt; kubeconfig.yaml</span></div>
              <div><span className="text-sky-400">kind:</span> <span className="select-all">kind get kubeconfig --name &lt;cluster&gt;</span></div>
              <div><span className="text-sky-400">generic:</span> <span className="select-all">kubectl config view --raw &gt; kubeconfig.yaml</span></div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Context {status?.contexts?.length ? `· ${status.contexts.length} found` : ""}</label>
          <select value={contextEdit} onChange={(e) => { setContextEdit(e.target.value); setTestPhase("idle"); }} className="w-full px-3 py-2 bg-slate-900/40 border text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}>
            <option value="">{status?.contexts?.length ? "(use current-context)" : "(no contexts — upload first)"}</option>
            {(status?.contexts ?? []).map((c) => (
              <option key={c.name} value={c.name}>{c.name} → {c.cluster}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Namespace Filter</label>
          <input value={namespaceEdit} onChange={(e) => setNamespaceEdit(e.target.value)} placeholder="(empty = all namespaces)" className="w-full px-3 py-2 bg-transparent border text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }} />
        </div>
      </div>

      <div className="space-y-1">
        <button onClick={() => setShowAdvanced((v) => !v)} className="text-[10px] uppercase tracking-widest underline" style={{ color: "var(--text-muted)" }}>{showAdvanced ? "▾ Hide advanced" : "▸ Advanced: filesystem path"}</button>
        {showAdvanced && (
          <div className="border p-2" style={{ borderColor: "var(--border-dim)", background: "rgba(2,6,23,0.35)" }}>
            <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Kubeconfig Path (fallback)</label>
            <input value={pathEdit} onChange={(e) => setPathEdit(e.target.value)} placeholder="~/.kube/config" className="w-full mt-1 px-3 py-2 bg-transparent border text-xs font-mono" style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }} />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Only when no file uploaded. Useful for local dev.</span>
          </div>
        )}
      </div>

      {testPhase === "testing" && <div className="flex items-center gap-2 text-xs font-mono p-2 border" style={{ borderColor: "rgba(14,165,233,0.3)", background: "rgba(14,165,233,0.08)", color: "#7dd3fc" }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</div>}
      {testPhase === "success" && status?.ok && (
        <div className="border p-2 space-y-1" style={{ borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)" }}>
          <div className="flex items-center gap-2 text-xs font-bold" style={{ color: "#10b981" }}><Check className="w-3.5 h-3.5" /> Connected — {status.clusterName} · {status.kubernetesVersion}</div>
          <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Nodes: <b style={{color:"#e5e7eb"}}>{status.nodeCount}</b> · Namespaces: <b style={{color:"#e5e7eb"}}>{status.namespaceCount}</b> · Server: <span className="break-all" style={{color:"#e5e7eb"}}>{status.serverUrl}</span></div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => test(false)} disabled={testing || saving || (!hasKube && !pathEdit)} className={cn("terminal-btn text-xs px-4 py-2 inline-flex items-center gap-1", (testing || saving) && "opacity-50")}>
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Test
        </button>
        <button onClick={() => test(true)} disabled={testing || saving || testPhase !== "success"} className={cn("text-xs px-4 py-2 inline-flex items-center gap-1 font-bold", testPhase === "success" ? "bg-emerald-500 text-black" : "terminal-btn opacity-40")} title={testPhase !== "success" ? "Test must succeed first" : undefined}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {testPhase === "success" ? "Save" : "Save (test first)"}
        </button>
        <span className="text-[11px] font-mono" style={{ color: testPhase === "success" ? "#10b981" : "var(--text-muted)" }}>{testPhase === "success" ? "✓ ready" : testPhase === "error" ? "✗ failed" : "Test first, then Save"}</span>
      </div>

      {error && <div className="border p-2" style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)" }}><p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{error}</p></div>}
    </div>
  );
}
