import fs from "fs";
import { randomBytes } from "crypto";
import * as k8s from "@kubernetes/client-node";
import { KubernetesObjectApi, PatchStrategy } from "@kubernetes/client-node";
import { sql } from "@/lib/db";
import { createWatchmenAgentObjects } from "@/lib/agents/k8s-manifest";
import {
  detectKubernetesDistribution,
  parseKubeconfigContexts,
  sliceKubeconfigForContext,
  validateKubeconfigContent,
  hasInlineKubeconfig as hasInlineKubeconfigLegacy,
} from "./local";
import type {
  KubernetesDistribution,
  KubeconfigContextInfo,
  LocalKubernetesResource,
  LocalKubernetesServicePort,
} from "./local";

// Re-export for consumers
export type { KubernetesDistribution, KubeconfigContextInfo };

export interface KubernetesClusterRecord {
  id: string;
  name: string;
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
  kubeconfigContent?: string;
  kubeconfigFilename?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KubernetesClusterStatus {
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
  hasKubeconfig: boolean;
  kubeconfigFilename?: string;
  distribution?: KubernetesDistribution;
  error?: string;
  code?: "disabled" | "missing_file" | "bad_context" | "unreachable" | "unauthorized" | "unknown";
  contexts?: KubeconfigContextInfo[];
}

export interface KubernetesClusterResourcesResponse {
  provider: "local_kubernetes";
  cluster: KubernetesClusterStatus;
  resources: LocalKubernetesResource[];
}

export interface KubernetesTestTrafficStatus {
  deployment: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  running: boolean;
}

export interface KubernetesAgentDeployResult {
  clusterName: string;
  namespace: string;
  applied: string[];
}

let clustersTableReady: Promise<void> | null = null;

async function ensureClustersTable(): Promise<void> {
  if (!clustersTableReady) {
    clustersTableReady = sql`
      CREATE TABLE IF NOT EXISTS user_kubernetes_clusters (
        id                TEXT PRIMARY KEY,
        user_email        TEXT NOT NULL,
        name              TEXT NOT NULL,
        enabled           BOOLEAN NOT NULL DEFAULT FALSE,
        kubeconfig_path   TEXT NOT NULL DEFAULT '~/.kube/config',
        context_name      TEXT NOT NULL DEFAULT '',
        namespace_name    TEXT NOT NULL DEFAULT 'watchmen',
        kubeconfig_encrypted TEXT,
        kubeconfig_filename  TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_email, name)
      )
    `.then(() => sql`CREATE INDEX IF NOT EXISTS idx_user_kubernetes_clusters_user ON user_kubernetes_clusters(user_email)`.then(() => undefined)).then(() => undefined);
  }
  return clustersTableReady;
}

function normalizeName(name: string): string {
  return name.trim().slice(0, 64);
}

function generateId(): string {
  // Node 19+ has crypto.randomUUID, fallback to math
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hasInlineKubeconfig(record: Partial<KubernetesClusterRecord>): boolean {
  return typeof record.kubeconfigContent === "string" && record.kubeconfigContent.trim().length > 0;
}

export async function listUserClusters(email: string): Promise<KubernetesClusterRecord[]> {
  await ensureClustersTable();
  // Auto-migrate legacy single config if no clusters yet
  try {
    const existing = await sql<{ count: string }>`SELECT COUNT(*) as count FROM user_kubernetes_clusters WHERE user_email = ${email}`;
    if (Number(existing.rows[0]?.count ?? 0) === 0) {
      const legacy = await sql<{
        enabled: boolean;
        kubeconfig_path: string;
        context_name: string;
        namespace_name: string;
        kubeconfig_encrypted: string | null;
        kubeconfig_filename: string | null;
      }>`SELECT enabled, kubeconfig_path, context_name, namespace_name, kubeconfig_encrypted, kubeconfig_filename FROM user_local_kubernetes_configs WHERE user_email = ${email} LIMIT 1`;
      const row = legacy.rows[0];
      if (row) {
        let content: string | undefined;
        if (row.kubeconfig_encrypted) {
          try {
            const { decrypt } = await import("@/lib/encryption");
            content = decrypt(row.kubeconfig_encrypted);
          } catch {}
        }
        // Only migrate if there is something meaningful (enabled or has kubeconfig)
        if (row.enabled || content) {
          const id = generateId();
          await sql`
            INSERT INTO user_kubernetes_clusters (id, user_email, name, enabled, kubeconfig_path, context_name, namespace_name, kubeconfig_encrypted, kubeconfig_filename, created_at, updated_at)
            VALUES (${id}, ${email}, ${"default"}, ${row.enabled}, ${row.kubeconfig_path}, ${row.context_name}, ${row.namespace_name}, ${row.kubeconfig_encrypted}, ${row.kubeconfig_filename}, NOW(), NOW())
            ON CONFLICT (user_email, name) DO NOTHING
          `;
        }
      }
    }
  } catch {
    // ignore migration errors
  }

  const res = await sql<{
    id: string;
    name: string;
    enabled: boolean;
    kubeconfig_path: string;
    context_name: string;
    namespace_name: string;
    kubeconfig_encrypted: string | null;
    kubeconfig_filename: string | null;
    created_at: string;
    updated_at: string;
  }>`SELECT id, name, enabled, kubeconfig_path, context_name, namespace_name, kubeconfig_encrypted, kubeconfig_filename, created_at, updated_at FROM user_kubernetes_clusters WHERE user_email = ${email} ORDER BY created_at ASC`;
  const out: KubernetesClusterRecord[] = [];
  for (const r of res.rows) {
    let content: string | undefined;
    let filename: string | undefined;
    if (r.kubeconfig_encrypted) {
      try {
        const { decrypt } = await import("@/lib/encryption");
        content = decrypt(r.kubeconfig_encrypted);
        filename = r.kubeconfig_filename ?? undefined;
      } catch {}
    }
    out.push({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      kubeconfigPath: r.kubeconfig_path,
      context: r.context_name,
      namespace: r.namespace_name,
      kubeconfigContent: content,
      kubeconfigFilename: filename,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return out;
}

export async function getUserCluster(email: string, id: string): Promise<KubernetesClusterRecord | null> {
  await ensureClustersTable();
  const res = await sql<{
    id: string;
    name: string;
    enabled: boolean;
    kubeconfig_path: string;
    context_name: string;
    namespace_name: string;
    kubeconfig_encrypted: string | null;
    kubeconfig_filename: string | null;
    created_at: string;
    updated_at: string;
  }>`SELECT id, name, enabled, kubeconfig_path, context_name, namespace_name, kubeconfig_encrypted, kubeconfig_filename, created_at, updated_at FROM user_kubernetes_clusters WHERE user_email = ${email} AND id = ${id} LIMIT 1`;
  const r = res.rows[0];
  if (!r) return null;
  let content: string | undefined;
  let filename: string | undefined;
  if (r.kubeconfig_encrypted) {
    try {
      const { decrypt } = await import("@/lib/encryption");
      content = decrypt(r.kubeconfig_encrypted);
      filename = r.kubeconfig_filename ?? undefined;
    } catch {}
  }
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    kubeconfigPath: r.kubeconfig_path,
    context: r.context_name,
    namespace: r.namespace_name,
    kubeconfigContent: content,
    kubeconfigFilename: filename,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createUserCluster(
  email: string,
  input: { name: string; enabled?: boolean; kubeconfigPath?: string; context?: string; namespace?: string; kubeconfigContent?: string; kubeconfigFilename?: string }
): Promise<KubernetesClusterRecord> {
  await ensureClustersTable();
  const name = normalizeName(input.name);
  if (!name) throw Object.assign(new Error("Cluster name is required."), { code: "bad_context" });
  if (!/^[a-z0-9][a-z0-9-_.\s]{1,62}[a-z0-9]$/i.test(name) && name.length < 2) {
    // allow 2-64 chars, alphanumeric + - _ . space
  }
  const id = generateId();
  const enabled = Boolean(input.enabled);
  const kubeconfigPath = String(input.kubeconfigPath ?? "~/.kube/config").trim() || "~/.kube/config";
  const context = String(input.context ?? "").trim();
  const namespace = String(input.namespace ?? "watchmen").trim() || "watchmen";
  let encrypted: string | null = null;
  let filename: string | null = null;
  let content: string | undefined;
  let storedContent: string | undefined;
  if (typeof input.kubeconfigContent === "string" && input.kubeconfigContent.trim()) {
    const trimmed = input.kubeconfigContent.trim();
    const v = validateKubeconfigContent(trimmed);
    if (v) throw Object.assign(new Error(v), { code: "bad_context" });
    // If a specific context is pinned and the file is a merged kubeconfig, store only that context
    const sliced = context ? sliceKubeconfigForContext(trimmed, context) : trimmed;
    storedContent = sliced;
    const { encrypt } = await import("@/lib/encryption");
    encrypted = encrypt(sliced);
    filename = (input.kubeconfigFilename ?? "kubeconfig.yaml").trim() || "kubeconfig.yaml";
    content = sliced;
  }
  // Reachability gate: if a kubeconfig is supplied and cluster is enabled, verify it can be reached
  // before persisting. Unreachable clusters are rejected and not added to the list.
  if (enabled && content && process.env.WATCHMEN_SKIP_K8S_REACHABILITY_CHECK !== "1" && process.env.NODE_ENV !== "test") {
    try {
      const probe: KubernetesClusterRecord = {
        id: "__probe__",
        name,
        enabled: true,
        kubeconfigPath,
        context,
        namespace,
        kubeconfigContent: content,
        kubeconfigFilename: filename ?? undefined,
      };
      const probed = await getClusterStatus(probe);
      if (!probed.ok && probed.code === "unreachable") {
        throw Object.assign(new Error(`Cluster "${name}" is unreachable: ${probed.error ?? "Kubernetes API is unreachable"}. Not added.`), { code: "unreachable" });
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err?.code === "unreachable") throw e;
      // non-unreachable probe failures (bad_context etc) should also surface and block creation
      if (err?.code === "bad_context" || err?.code === "missing_file") throw e;
      // otherwise ignore probe errors and allow insert (e.g. unauthorized is not unreachable)
    }
  }
  try {
    await sql`
      INSERT INTO user_kubernetes_clusters (id, user_email, name, enabled, kubeconfig_path, context_name, namespace_name, kubeconfig_encrypted, kubeconfig_filename, created_at, updated_at)
      VALUES (${id}, ${email}, ${name}, ${enabled}, ${kubeconfigPath}, ${context}, ${namespace}, ${encrypted}, ${filename}, NOW(), NOW())
    `;
  } catch (e: unknown) {
    const msg = String((e as { message?: string })?.message ?? "");
    if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("UNIQUE")) {
      throw Object.assign(new Error(`Cluster name "${name}" already exists.`), { code: "bad_context" });
    }
    throw e;
  }
  return { id, name, enabled, kubeconfigPath, context, namespace, kubeconfigContent: content, kubeconfigFilename: filename ?? undefined };
}

export async function updateUserCluster(
  email: string,
  id: string,
  input: Partial<{ name: string; enabled: boolean; kubeconfigPath: string; context: string; namespace: string; kubeconfigContent: string | null; kubeconfigFilename: string }>
): Promise<KubernetesClusterRecord> {
  await ensureClustersTable();
  const existing = await getUserCluster(email, id);
  if (!existing) throw Object.assign(new Error("Cluster not found."), { code: "missing_file" });
  const name = input.name !== undefined ? normalizeName(input.name) : existing.name;
  if (!name) throw Object.assign(new Error("Cluster name is required."), { code: "bad_context" });
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled;
  const kubeconfigPath = input.kubeconfigPath !== undefined ? String(input.kubeconfigPath).trim() || "~/.kube/config" : existing.kubeconfigPath;
  const context = input.context !== undefined ? String(input.context).trim() : existing.context;
  const namespace = input.namespace !== undefined ? String(input.namespace).trim() || "watchmen" : existing.namespace;

  let encrypted: string | null | undefined = undefined;
  let filename: string | null | undefined = undefined;
  let content: string | undefined = existing.kubeconfigContent;

  if (input.kubeconfigContent !== undefined) {
    if (input.kubeconfigContent === null || String(input.kubeconfigContent).trim() === "") {
      encrypted = null;
      filename = null;
      content = undefined;
    } else {
      const trimmed = String(input.kubeconfigContent).trim();
      const v = validateKubeconfigContent(trimmed);
      if (v) throw Object.assign(new Error(v), { code: "bad_context" });
      const sliced = context ? sliceKubeconfigForContext(trimmed, context) : trimmed;
      const { encrypt } = await import("@/lib/encryption");
      encrypted = encrypt(sliced);
      filename = String(input.kubeconfigFilename ?? existing.kubeconfigFilename ?? "kubeconfig.yaml").trim() || "kubeconfig.yaml";
      content = sliced;
    }
  } else {
    // keep existing
    const row = await sql<{ kubeconfig_encrypted: string | null; kubeconfig_filename: string | null }>`SELECT kubeconfig_encrypted, kubeconfig_filename FROM user_kubernetes_clusters WHERE user_email = ${email} AND id = ${id} LIMIT 1`;
    encrypted = row.rows[0]?.kubeconfig_encrypted ?? null;
    filename = row.rows[0]?.kubeconfig_filename ?? null;
  }

  // Build update - handle encrypted/filename separately to allow null
  if (encrypted !== undefined) {
    await sql`
      UPDATE user_kubernetes_clusters
      SET name = ${name}, enabled = ${enabled}, kubeconfig_path = ${kubeconfigPath}, context_name = ${context}, namespace_name = ${namespace}, kubeconfig_encrypted = ${encrypted}, kubeconfig_filename = ${filename}, updated_at = NOW()
      WHERE user_email = ${email} AND id = ${id}
    `;
  } else {
    await sql`
      UPDATE user_kubernetes_clusters
      SET name = ${name}, enabled = ${enabled}, kubeconfig_path = ${kubeconfigPath}, context_name = ${context}, namespace_name = ${namespace}, updated_at = NOW()
      WHERE user_email = ${email} AND id = ${id}
    `;
  }
  const updated = await getUserCluster(email, id);
  if (!updated) throw new Error("Update failed");
  // Preserve content for return if we just encrypted
  if (content) {
    updated.kubeconfigContent = content;
    updated.kubeconfigFilename = filename ?? undefined;
  }
  return updated;
}

export async function deleteUserCluster(email: string, id: string): Promise<void> {
  await ensureClustersTable();
  await sql`DELETE FROM user_kubernetes_clusters WHERE user_email = ${email} AND id = ${id}`;
}

export async function deleteUserClusterKubeconfig(email: string, id: string): Promise<void> {
  await ensureClustersTable();
  await sql`UPDATE user_kubernetes_clusters SET kubeconfig_encrypted = NULL, kubeconfig_filename = NULL, updated_at = NOW() WHERE user_email = ${email} AND id = ${id}`;
}

// ---- KubeConfig helpers ----

function getClusterName(kc: k8s.KubeConfig): string {
  return kc.getCurrentCluster()?.name || kc.getCurrentContext() || "local-kubernetes";
}

function labelsOf(resource: { metadata?: { labels?: Record<string, string> } }): Record<string, string> {
  return resource.metadata?.labels ?? {};
}

export function loadClusterKubeConfig(cluster: KubernetesClusterRecord): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  const content = cluster.kubeconfigContent?.trim();
  if (content) {
    try {
      kc.loadFromString(content);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Invalid kubeconfig content.";
      throw Object.assign(new Error(msg), { code: "bad_context" });
    }
  } else {
    const kubeconfigPath = cluster.kubeconfigPath;
    // Reuse expand logic from local.ts but inline to avoid circular
    const home = process.env.HOME ?? "";
    let p = kubeconfigPath.trim() || "~/.kube/config";
    if (p === "~") p = home;
    else if (p.startsWith("~/")) p = home + p.slice(1);
    if (!fs.existsSync(p)) {
      throw Object.assign(new Error(`Kubeconfig file not found at ${p}. Upload a kubeconfig file in Settings.`), { code: "missing_file" });
    }
    kc.loadFromFile(p);
  }
  const context = cluster.context || kc.getCurrentContext();
  if (!context) throw Object.assign(new Error("No Kubernetes context is configured."), { code: "bad_context" });
  if (!kc.getContexts().some((c) => c.name === context)) {
    const hint = content ? "uploaded kubeconfig" : cluster.kubeconfigPath;
    throw Object.assign(new Error(`Kubernetes context "${context}" was not found in ${hint}.`), { code: "bad_context" });
  }
  kc.setCurrentContext(context);
  return kc;
}

function classifyError(error: unknown): Pick<KubernetesClusterStatus, "code" | "error"> {
  const e = error as { code?: string; message?: string; statusCode?: number; body?: { message?: string }; response?: { statusCode?: number }; cause?: unknown };
  const status = Number(e?.statusCode ?? (e as { code?: unknown })?.code ?? e?.response?.statusCode ?? 0);
  const rawMessage = e?.body?.message || e?.message || String(error);
  const causeMsg = (e as { cause?: { message?: string } })?.cause ? String((e as { cause?: { message?: string } })?.cause?.message ?? (e as { cause?: unknown })?.cause) : "";
  const message = causeMsg ? `${rawMessage} ${causeMsg}` : rawMessage;
  const lower = message.toLowerCase();
  if (e?.code === "missing_file") return { code: "missing_file", error: message };
  if (e?.code === "bad_context") return { code: "bad_context", error: message };
  if (e?.code === "unreachable") return { code: "unreachable", error: message };
  if (status === 401 || status === 403) return { code: "unauthorized", error: `Kubernetes API rejected this context: ${message}` };
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND") ||
    lower.includes("timeout after") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("eai_again") ||
    lower.includes("econnreset") ||
    lower.includes("ehostunreach") ||
    lower.includes("socket hang up") ||
    lower.includes("unable to connect") ||
    lower.includes("connect timeout")
  ) {
    return { code: "unreachable", error: `Kubernetes API is unreachable: ${message}` };
  }
  return { code: "unknown", error: message };
}

export async function getClusterStatus(cluster: KubernetesClusterRecord): Promise<KubernetesClusterStatus> {
  const kubeconfigPath = cluster.kubeconfigPath;
  const hasInline = hasInlineKubeconfig(cluster);
  let contexts: KubeconfigContextInfo[] | undefined;
  if (hasInline && cluster.kubeconfigContent) {
    try {
      contexts = parseKubeconfigContexts(cluster.kubeconfigContent);
    } catch {}
  } else if (cluster.kubeconfigContent) {
    try {
      contexts = parseKubeconfigContexts(cluster.kubeconfigContent);
    } catch {}
  }
  // If this cluster is pinned to a single context but the stored kubeconfig still contains
  // many contexts (legacy merged upload), only expose the pinned context in the selector
  // so unreachable sibling contexts are removed from the UI.
  if (cluster.context && contexts && contexts.length > 1) {
    const pinned = contexts.filter((c) => c.name === cluster.context);
    if (pinned.length === 1) contexts = pinned;
  }

  if (!cluster.enabled) {
    return {
      ok: false,
      enabled: false,
      kubeconfigPath,
      context: cluster.context,
      namespace: cluster.namespace,
      clusterName: "",
      serverUrl: "",
      kubernetesVersion: "",
      nodeCount: 0,
      namespaceCount: 0,
      hasKubeconfig: hasInline,
      kubeconfigFilename: cluster.kubeconfigFilename,
      contexts,
      code: "disabled",
      error: "Cluster is disabled.",
    };
  }

  try {
    const kc = loadClusterKubeConfig(cluster);
    // Preview contexts from loaded kc
    try {
      const loadedContexts = kc.getContexts().map((c: unknown) => {
        const ctx = c as { name: string; cluster?: string; user?: string; namespace?: string };
        return { name: ctx.name, cluster: ctx.cluster ?? "", user: ctx.user ?? "", namespace: ctx.namespace };
      });
      if (loadedContexts.length) contexts = loadedContexts;
    } catch {}
    const core = kc.makeApiClient(k8s.CoreV1Api) as unknown as { listNode: () => Promise<{ items?: unknown[] }>; listNamespace: () => Promise<{ items?: unknown[] }> };
    const versionApi = kc.makeApiClient(k8s.VersionApi) as unknown as { getCode: () => Promise<{ gitVersion?: string }> };
    const timeout = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error(`timeout after ${ms}ms`), { code: "unreachable" })), ms)
      );
    const [version, nodes, namespaces] = await Promise.race([
      Promise.all([versionApi.getCode(), core.listNode(), core.listNamespace()]),
      timeout(15000),
    ]) as [Awaited<ReturnType<typeof versionApi.getCode>>, Awaited<ReturnType<typeof core.listNode>>, Awaited<ReturnType<typeof core.listNamespace>>];
    const kubernetesVersion = version.gitVersion ?? "";
    const serverUrl = kc.getCurrentCluster()?.server ?? "";
    const clusterName = getClusterName(kc);
    return {
      ok: true,
      enabled: true,
      kubeconfigPath,
      context: kc.getCurrentContext(),
      namespace: cluster.namespace,
      clusterName,
      serverUrl,
      kubernetesVersion,
      nodeCount: (nodes as { items?: unknown[] }).items?.length ?? 0,
      namespaceCount: (namespaces as { items?: unknown[] }).items?.length ?? 0,
      hasKubeconfig: hasInline,
      kubeconfigFilename: cluster.kubeconfigFilename,
      distribution: detectKubernetesDistribution(kubernetesVersion, serverUrl, clusterName),
      contexts,
    };
  } catch (error: unknown) {
    const classified = classifyError(error);
    return {
      ok: false,
      enabled: cluster.enabled,
      kubeconfigPath,
      context: cluster.context,
      namespace: cluster.namespace,
      clusterName: "",
      serverUrl: "",
      kubernetesVersion: "",
      nodeCount: 0,
      namespaceCount: 0,
      hasKubeconfig: hasInline,
      kubeconfigFilename: cluster.kubeconfigFilename,
      contexts,
      ...classified,
    };
  }
}

export function normalizeKubernetesService(service: unknown, clusterName = "local-kubernetes"): LocalKubernetesResource {
  const s = service as { metadata?: { name?: string; namespace?: string; labels?: Record<string, string> }; spec?: { type?: string; clusterIP?: string; selector?: Record<string, string>; ports?: Array<{ name?: string; protocol?: string; port?: number; targetPort?: unknown; nodePort?: number }> } };
  const namespace = s.metadata?.namespace ?? "default";
  const name = s.metadata?.name ?? "";
  const ports: LocalKubernetesServicePort[] = ((s.spec?.ports ?? []) as unknown[]).map((p) => {
    const port = p as { name?: string; protocol?: string; port?: number; targetPort?: unknown; nodePort?: number };
    return { name: port.name ?? "", protocol: port.protocol ?? "TCP", port: Number(port.port ?? 0), targetPort: (port.targetPort as string | number | null) ?? null, nodePort: port.nodePort ? Number(port.nodePort) : null };
  });
  return {
    id: `local-kubernetes:service:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind: "service",
    name,
    namespace,
    clusterName,
    labels: labelsOf(service as { metadata?: { labels?: Record<string, string> } }),
    selectors: s.spec?.selector ?? {},
    serviceType: s.spec?.type ?? "ClusterIP",
    clusterIP: s.spec?.clusterIP,
    ports,
    accessHint: `kubectl -n ${namespace} port-forward service/${name} 18080:${ports[0]?.port ?? 80}`,
  };
}

export function normalizeKubernetesPod(pod: unknown, clusterName = "local-kubernetes"): LocalKubernetesResource {
  const p = pod as { metadata?: { name?: string; namespace?: string; labels?: Record<string, string> }; spec?: { nodeName?: string; containers?: Array<{ name: string }> }; status?: { phase?: string; podIP?: string; hostIP?: string } };
  const namespace = p.metadata?.namespace ?? "default";
  const name = p.metadata?.name ?? "";
  return {
    id: `local-kubernetes:pod:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind: "pod",
    name,
    namespace,
    clusterName,
    labels: labelsOf(pod as { metadata?: { labels?: Record<string, string> } }),
    podIP: p.status?.podIP,
    hostIP: p.status?.hostIP,
    nodeName: p.spec?.nodeName,
    phase: p.status?.phase,
    containers: (p.spec?.containers ?? []).map((c) => c.name).filter(Boolean),
  };
}

export function normalizeKubernetesWorkload(workload: unknown, kind: "deployment" | "daemonset" | "statefulset", clusterName = "local-kubernetes"): LocalKubernetesResource {
  const w = workload as { metadata?: { name?: string; namespace?: string; labels?: Record<string, string> }; spec?: { replicas?: number; selector?: { matchLabels?: Record<string, string> }; template?: { spec?: { containers?: Array<{ name: string }> } } }; status?: { readyReplicas?: number; availableReplicas?: number } };
  const namespace = w.metadata?.namespace ?? "default";
  const name = w.metadata?.name ?? "";
  return {
    id: `local-kubernetes:${kind}:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind,
    name,
    namespace,
    clusterName,
    labels: labelsOf(workload as { metadata?: { labels?: Record<string, string> } }),
    selectors: w.spec?.selector?.matchLabels ?? {},
    containers: (w.spec?.template?.spec?.containers ?? []).map((c) => c.name).filter(Boolean),
    replicas: w.spec?.replicas,
    readyReplicas: w.status?.readyReplicas,
    availableReplicas: w.status?.availableReplicas,
  };
}

async function listForNamespaces<T>(namespaces: string[], namespaceFilter: string, allNamespacesCall: () => Promise<{ items?: T[] }>, namespacedCall: (ns: string) => Promise<{ items?: T[] }>): Promise<T[]> {
  if (!namespaceFilter) return (await allNamespacesCall()).items ?? [];
  const results = await Promise.all(namespaces.map((ns) => namespacedCall(ns).then((list) => list.items ?? [])));
  return results.flat();
}

export async function getClusterResources(cluster: KubernetesClusterRecord): Promise<KubernetesClusterResourcesResponse> {
  const status = await getClusterStatus(cluster);
  if (!status.ok) return { provider: "local_kubernetes", cluster: status, resources: [] };
  const kc = loadClusterKubeConfig(cluster);
  const core = kc.makeApiClient(k8s.CoreV1Api) as unknown as {
    listNamespace: () => Promise<{ items?: Array<{ metadata?: { name?: string } }> }>;
    listPodForAllNamespaces: (opts: unknown) => Promise<{ items?: unknown[] }>;
    listNamespacedPod: (opts: { namespace: string; labelSelector?: string; fieldSelector?: string }) => Promise<{ items?: unknown[] }>;
    listNamespacedService: (opts: { namespace: string }) => Promise<{ items?: unknown[] }>;
  };
  const apps = kc.makeApiClient(k8s.AppsV1Api) as unknown as {
    listDeploymentForAllNamespaces: (opts: unknown) => Promise<{ items?: unknown[] }>;
    listNamespacedDeployment: (opts: { namespace: string }) => Promise<{ items?: unknown[] }>;
    listNamespacedDaemonSet: (opts: { namespace: string }) => Promise<{ items?: unknown[] }>;
    listNamespacedStatefulSet: (opts: { namespace: string }) => Promise<{ items?: unknown[] }>;
  };
  const namespaceFilter = cluster.namespace.trim();
  const namespaceList = await core.listNamespace();
  const namespaceNames = (namespaceList.items ?? []).map((ns) => ns.metadata?.name).filter(Boolean).filter((ns): ns is string => Boolean(ns) && (!namespaceFilter || ns === namespaceFilter)) as string[];

  const [pods, services, deployments, daemonsets, statefulsets] = await Promise.all([
    listForNamespaces(namespaceNames, namespaceFilter, () => core.listPodForAllNamespaces({}), (ns: string) => core.listNamespacedPod({ namespace: ns })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((ns: string) => core.listNamespacedService({ namespace: ns })));
      return { items: lists.flatMap((l) => (l as { items?: unknown[] }).items ?? []) };
    }, (ns: string) => core.listNamespacedService({ namespace: ns })),
    listForNamespaces(namespaceNames, namespaceFilter, () => apps.listDeploymentForAllNamespaces({}), (ns: string) => apps.listNamespacedDeployment({ namespace: ns })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((ns: string) => apps.listNamespacedDaemonSet({ namespace: ns })));
      return { items: lists.flatMap((l) => (l as { items?: unknown[] }).items ?? []) };
    }, (ns: string) => apps.listNamespacedDaemonSet({ namespace: ns })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((ns: string) => apps.listNamespacedStatefulSet({ namespace: ns })));
      return { items: lists.flatMap((l) => (l as { items?: unknown[] }).items ?? []) };
    }, (ns: string) => apps.listNamespacedStatefulSet({ namespace: ns })),
  ]);

  const clusterResource: LocalKubernetesResource = { id: `local-kubernetes:cluster:${status.clusterName}`, provider: "local_kubernetes", kind: "cluster", name: status.clusterName, clusterName: status.clusterName, labels: {} };
  const namespaceResources = namespaceNames.map((ns: string) => ({ id: `local-kubernetes:namespace:${ns}`, provider: "local_kubernetes" as const, kind: "namespace" as const, name: ns, namespace: ns, clusterName: status.clusterName, labels: {} }));

  return {
    provider: "local_kubernetes",
    cluster: status,
    resources: [
      clusterResource,
      ...namespaceResources,
      ...deployments.map((i) => normalizeKubernetesWorkload(i, "deployment", status.clusterName)),
      ...daemonsets.map((i) => normalizeKubernetesWorkload(i, "daemonset", status.clusterName)),
      ...statefulsets.map((i) => normalizeKubernetesWorkload(i, "statefulset", status.clusterName)),
      ...services.map((i) => normalizeKubernetesService(i, status.clusterName)),
      ...pods.map((i) => normalizeKubernetesPod(i, status.clusterName)),
    ],
  };
}

const TEST_TRAFFIC_GENERATOR_DEPLOYMENT = "watchmen-trace-generator";

function testTrafficDeploymentSpec(namespace: string) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: TEST_TRAFFIC_GENERATOR_DEPLOYMENT,
      namespace,
    },
  };
}

export async function getClusterTestTrafficStatus(cluster: KubernetesClusterRecord): Promise<KubernetesTestTrafficStatus> {
  if (!cluster.enabled) {
    throw Object.assign(new Error("Cluster is disabled."), { code: "disabled" });
  }
  const namespace = cluster.namespace || "watchmen";
  const kc = loadClusterKubeConfig(cluster);
  const objectApi = KubernetesObjectApi.makeApiClient(kc);
  const deployment = await objectApi.read(testTrafficDeploymentSpec(namespace)) as {
    spec?: { replicas?: number };
    status?: { readyReplicas?: number };
  };
  const replicas = Number(deployment.spec?.replicas ?? 0);
  const readyReplicas = Number(deployment.status?.readyReplicas ?? 0);
  return {
    deployment: TEST_TRAFFIC_GENERATOR_DEPLOYMENT,
    namespace,
    replicas,
    readyReplicas,
    running: replicas > 0,
  };
}

export async function setClusterTestTrafficRunning(cluster: KubernetesClusterRecord, running: boolean): Promise<KubernetesTestTrafficStatus> {
  if (!cluster.enabled) {
    throw Object.assign(new Error("Cluster is disabled."), { code: "disabled" });
  }
  const namespace = cluster.namespace || "watchmen";
  const kc = loadClusterKubeConfig(cluster);
  const objectApi = KubernetesObjectApi.makeApiClient(kc);
  await objectApi.patch(
    {
      ...testTrafficDeploymentSpec(namespace),
      spec: {
        replicas: running ? 1 : 0,
      },
    },
    undefined,
    undefined,
    "watchmen-ui",
    undefined,
    PatchStrategy.MergePatch,
  );
  return getClusterTestTrafficStatus(cluster);
}

export async function deployClusterWatchmenAgent(cluster: KubernetesClusterRecord, origin: string): Promise<KubernetesAgentDeployResult> {
  if (!cluster.enabled) {
    throw Object.assign(new Error("Cluster is disabled."), { code: "disabled" });
  }
  const status = await getClusterStatus(cluster);
  if (!status.ok) {
    throw Object.assign(new Error(status.error ?? "Cluster is not connected."), { code: status.code ?? "unknown" });
  }

  const namespace = cluster.namespace || "watchmen";
  const kc = loadClusterKubeConfig(cluster);
  const objectApi = KubernetesObjectApi.makeApiClient(kc);
  const objects = createWatchmenAgentObjects({
    clusterName: status.clusterName || cluster.name,
    projectId: "self-managed",
    location: cluster.context || status.context || "local",
    namespace,
    origin,
    agentSecret: randomBytes(32).toString("hex"),
    binaryUrl: "",
    binaryBaseUrl: `${origin}/api/agents/k8s/binary`,
  });

  const applied: string[] = [];
  for (const object of objects) {
    await objectApi.patch(
      object,
      undefined,
      undefined,
      "watchmen-ui",
      true,
      PatchStrategy.ServerSideApply,
    );
    applied.push(`${object.kind ?? "Object"}/${object.metadata?.name ?? ""}`);
  }

  return {
    clusterName: status.clusterName || cluster.name,
    namespace,
    applied,
  };
}

export function parseKubernetesLogLine(line: string): { timestamp: string; message: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
  if (!match) return { timestamp: "", message: line };
  return { timestamp: match[1], message: match[2] };
}

export async function getClusterLogs(
  cluster: KubernetesClusterRecord,
  options: { namespace?: string; pod?: string; deployment?: string; app?: string; container?: string; after?: string; search?: string; limit?: number }
): Promise<Array<{ timestamp: string; severity: string; message: string; namespace: string; pod: string; container: string; labels: Record<string, string>; sourceProvider: "local_kubernetes" }>> {
  if (!cluster.enabled) return [];
  const kc = loadClusterKubeConfig(cluster);
  const core = kc.makeApiClient(k8s.CoreV1Api) as unknown as {
    listNamespacedPod: (opts: { namespace: string; labelSelector?: string; fieldSelector?: string }) => Promise<{ items?: Array<{ metadata?: { name?: string; uid?: string; labels?: Record<string, string> }; spec?: { containers?: Array<{ name: string }> } }> }>;
    readNamespacedPodLog: (opts: { name: string; namespace: string; container: string; sinceSeconds?: number; tailLines: number; timestamps: boolean }) => Promise<string>;
  };
  const namespace = options.namespace || cluster.namespace || "default";
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const afterMs = options.after ? Date.parse(options.after) : 0;
  const sinceSeconds = afterMs > 0 ? Math.max(1, Math.ceil((Date.now() - afterMs) / 1000) + 5) : undefined;

  let pods: Array<{ metadata?: { name?: string; uid?: string; labels?: Record<string, string> }; spec?: { containers?: Array<{ name: string }> } }> = [];
  if (options.pod) {
    const list = await core.listNamespacedPod({ namespace, fieldSelector: `metadata.name=${options.pod}` });
    pods = (list.items ?? []) as typeof pods;
  } else {
    const selectors: string[] = [];
    if (options.app) selectors.push(`app=${options.app}`);
    if (options.deployment) selectors.push(`app=${options.deployment}`, `app.kubernetes.io/name=${options.deployment}`);
    const podLists = selectors.length > 0
      ? await Promise.all(selectors.map((sel) => core.listNamespacedPod({ namespace, labelSelector: sel }).catch(() => ({ items: [] } as { items?: typeof pods }))))
      : [await core.listNamespacedPod({ namespace })];
    const seen = new Set<string>();
    pods = (podLists.flatMap((l) => (l as { items?: typeof pods }).items ?? []) as typeof pods).filter((pod) => {
      const key = pod.metadata?.uid || pod.metadata?.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      if (!options.deployment) return true;
      return String(pod.metadata?.name ?? "").startsWith(`${options.deployment}-`) || pod.metadata?.labels?.app === options.deployment || pod.metadata?.labels?.["app.kubernetes.io/name"] === options.deployment;
    });
  }

  const entries: Array<{ timestamp: string; severity: string; message: string; namespace: string; pod: string; container: string; labels: Record<string, string>; sourceProvider: "local_kubernetes" }> = [];
  await Promise.all(
    pods.map(async (pod) => {
      const containers = options.container ? [options.container] : (pod.spec?.containers ?? []).map((c) => c.name).filter(Boolean);
      await Promise.all(
        containers.map(async (container: string) => {
          const raw = await core
            .readNamespacedPodLog({ name: pod.metadata?.name ?? "", namespace, container, sinceSeconds, tailLines: limit, timestamps: true })
            .catch(() => "");
          for (const line of String(raw).split("\n").filter(Boolean)) {
            const parsed = parseKubernetesLogLine(line);
            if (afterMs > 0 && parsed.timestamp && Date.parse(parsed.timestamp) <= afterMs) continue;
            if (options.search && !parsed.message.toLowerCase().includes(options.search.toLowerCase())) continue;
            entries.push({
              timestamp: parsed.timestamp || new Date().toISOString(),
              severity: "DEFAULT",
              message: parsed.message,
              namespace,
              pod: pod.metadata?.name ?? "",
              container,
              labels: labelsOf(pod as { metadata?: { labels?: Record<string, string> } }),
              sourceProvider: "local_kubernetes",
            });
          }
        })
      );
    })
  );

  return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, limit);
}
