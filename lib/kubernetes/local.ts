import fs from "fs";
import os from "os";
import path from "path";
import * as k8s from "@kubernetes/client-node";
import { sql } from "@/lib/db";

export interface LocalKubernetesConfig {
  enabled: boolean;
  kubeconfigPath: string;
  context: string;
  namespace: string;
}

export interface LocalKubernetesStatus {
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
  error?: string;
  code?: "disabled" | "missing_file" | "bad_context" | "unreachable" | "unauthorized" | "unknown";
}

export interface LocalKubernetesServicePort {
  name: string;
  protocol: string;
  port: number;
  targetPort: string | number | null;
  nodePort: number | null;
}

export interface LocalKubernetesResource {
  id: string;
  provider: "local_kubernetes";
  kind: "cluster" | "namespace" | "deployment" | "daemonset" | "statefulset" | "pod" | "service";
  name: string;
  namespace?: string;
  clusterName: string;
  labels: Record<string, string>;
  selectors?: Record<string, string>;
  ports?: LocalKubernetesServicePort[];
  serviceType?: string;
  clusterIP?: string;
  podIP?: string;
  hostIP?: string;
  nodeName?: string;
  phase?: string;
  containers?: string[];
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  accessHint?: string;
}

export interface LocalKubernetesResourcesResponse {
  provider: "local_kubernetes";
  cluster: LocalKubernetesStatus;
  resources: LocalKubernetesResource[];
}

export interface LocalKubernetesLogEntry {
  timestamp: string;
  severity: string;
  message: string;
  namespace: string;
  pod: string;
  container: string;
  labels: Record<string, string>;
  sourceProvider: "local_kubernetes";
}

export const DEFAULT_LOCAL_KUBERNETES_CONFIG: LocalKubernetesConfig = {
  enabled: process.env.WATCHMEN_ENABLE_LOCAL_KUBERNETES === "true",
  kubeconfigPath: process.env.WATCHMEN_KUBECONFIG || process.env.KUBECONFIG || "~/.kube/config",
  context: process.env.WATCHMEN_KUBE_CONTEXT || "",
  namespace: process.env.WATCHMEN_KUBE_NAMESPACE || "watchmen",
};

let localKubernetesConfigTableReady: Promise<void> | null = null;

async function ensureLocalKubernetesConfigTable(): Promise<void> {
  if (!localKubernetesConfigTableReady) {
    localKubernetesConfigTableReady = sql`
      CREATE TABLE IF NOT EXISTS user_local_kubernetes_configs (
        user_email      TEXT PRIMARY KEY,
        enabled         BOOLEAN NOT NULL DEFAULT FALSE,
        kubeconfig_path TEXT NOT NULL DEFAULT '~/.kube/config',
        context_name    TEXT NOT NULL DEFAULT '',
        namespace_name  TEXT NOT NULL DEFAULT 'watchmen',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `.then(() => undefined);
  }
  return localKubernetesConfigTableReady;
}

export function expandKubeconfigPath(input: string, homeDir = os.homedir()): string {
  const trimmed = input.trim();
  if (!trimmed) return path.join(homeDir, ".kube", "config");
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) return path.join(homeDir, trimmed.slice(2));
  return trimmed;
}

export function normalizeLocalKubernetesConfig(input: Partial<LocalKubernetesConfig> = {}): LocalKubernetesConfig {
  return {
    enabled: Boolean(input.enabled ?? DEFAULT_LOCAL_KUBERNETES_CONFIG.enabled),
    kubeconfigPath: String(input.kubeconfigPath ?? DEFAULT_LOCAL_KUBERNETES_CONFIG.kubeconfigPath).trim() || "~/.kube/config",
    context: String(input.context ?? DEFAULT_LOCAL_KUBERNETES_CONFIG.context).trim(),
    namespace: String(input.namespace ?? DEFAULT_LOCAL_KUBERNETES_CONFIG.namespace).trim(),
  };
}

function envOverridesConfig(): boolean {
  return Boolean(
    process.env.WATCHMEN_ENABLE_LOCAL_KUBERNETES ||
    process.env.WATCHMEN_KUBECONFIG ||
    process.env.WATCHMEN_KUBE_CONTEXT ||
    process.env.WATCHMEN_KUBE_NAMESPACE ||
    process.env.KUBECONFIG
  );
}

export async function getUserLocalKubernetesConfig(email: string): Promise<LocalKubernetesConfig> {
  if (envOverridesConfig()) return normalizeLocalKubernetesConfig(DEFAULT_LOCAL_KUBERNETES_CONFIG);
  await ensureLocalKubernetesConfigTable();
  const result = await sql<{
    enabled: boolean;
    kubeconfig_path: string;
    context_name: string;
    namespace_name: string;
  }>`
    SELECT enabled, kubeconfig_path, context_name, namespace_name
    FROM user_local_kubernetes_configs
    WHERE user_email = ${email}
    LIMIT 1
  `;
  const row = result.rows[0];
  if (!row) return normalizeLocalKubernetesConfig(DEFAULT_LOCAL_KUBERNETES_CONFIG);
  return normalizeLocalKubernetesConfig({
    enabled: row.enabled,
    kubeconfigPath: row.kubeconfig_path,
    context: row.context_name,
    namespace: row.namespace_name,
  });
}

export async function saveUserLocalKubernetesConfig(email: string, input: Partial<LocalKubernetesConfig>): Promise<LocalKubernetesConfig> {
  const config = normalizeLocalKubernetesConfig(input);
  await ensureLocalKubernetesConfigTable();
  await sql`
    INSERT INTO user_local_kubernetes_configs (user_email, enabled, kubeconfig_path, context_name, namespace_name, updated_at)
    VALUES (${email}, ${config.enabled}, ${config.kubeconfigPath}, ${config.context}, ${config.namespace}, NOW())
    ON CONFLICT (user_email) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          kubeconfig_path = EXCLUDED.kubeconfig_path,
          context_name = EXCLUDED.context_name,
          namespace_name = EXCLUDED.namespace_name,
          updated_at = NOW()
  `;
  return config;
}

export function loadLocalKubeConfig(config: LocalKubernetesConfig): k8s.KubeConfig {
  const kubeconfigPath = expandKubeconfigPath(config.kubeconfigPath);
  if (!fs.existsSync(kubeconfigPath)) {
    throw Object.assign(new Error(`Kubeconfig file not found at ${kubeconfigPath}.`), { code: "missing_file" });
  }

  const kc = new k8s.KubeConfig();
  kc.loadFromFile(kubeconfigPath);

  const context = config.context || kc.getCurrentContext();
  if (!context) {
    throw Object.assign(new Error("No Kubernetes context is configured. Set a context or run kubectl config use-context."), { code: "bad_context" });
  }
  if (!kc.getContexts().some((candidate) => candidate.name === context)) {
    throw Object.assign(new Error(`Kubernetes context "${context}" was not found in ${kubeconfigPath}.`), { code: "bad_context" });
  }
  kc.setCurrentContext(context);
  return kc;
}

function getClusterName(kc: k8s.KubeConfig): string {
  return kc.getCurrentCluster()?.name || kc.getCurrentContext() || "local-kubernetes";
}

function labelsOf(resource: { metadata?: { labels?: Record<string, string> } }): Record<string, string> {
  return resource.metadata?.labels ?? {};
}

export function normalizeKubernetesService(service: any, clusterName = "local-kubernetes"): LocalKubernetesResource {
  const namespace = service.metadata?.namespace ?? "default";
  const name = service.metadata?.name ?? "";
  const ports = ((service.spec?.ports ?? []) as any[]).map((port: any) => ({
    name: port.name ?? "",
    protocol: port.protocol ?? "TCP",
    port: Number(port.port ?? 0),
    targetPort: port.targetPort ?? null,
    nodePort: port.nodePort ? Number(port.nodePort) : null,
  }));
  const firstNodePort = ports.find((port) => port.nodePort)?.nodePort;
  return {
    id: `local-kubernetes:service:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind: "service",
    name,
    namespace,
    clusterName,
    labels: labelsOf(service),
    selectors: service.spec?.selector ?? {},
    serviceType: service.spec?.type ?? "ClusterIP",
    clusterIP: service.spec?.clusterIP,
    ports,
    accessHint: firstNodePort
      ? `kubectl -n ${namespace} port-forward service/${name} 18080:${ports[0]?.port ?? 80}`
      : `kubectl -n ${namespace} port-forward service/${name} 18080:${ports[0]?.port ?? 80}`,
  };
}

export function normalizeKubernetesPod(pod: any, clusterName = "local-kubernetes"): LocalKubernetesResource {
  const namespace = pod.metadata?.namespace ?? "default";
  const name = pod.metadata?.name ?? "";
  return {
    id: `local-kubernetes:pod:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind: "pod",
    name,
    namespace,
    clusterName,
    labels: labelsOf(pod),
    podIP: pod.status?.podIP,
    hostIP: pod.status?.hostIP,
    nodeName: pod.spec?.nodeName,
    phase: pod.status?.phase,
    containers: (pod.spec?.containers ?? []).map((container: any) => container.name).filter(Boolean),
  };
}

export function normalizeKubernetesWorkload(workload: any, kind: "deployment" | "daemonset" | "statefulset", clusterName = "local-kubernetes"): LocalKubernetesResource {
  const namespace = workload.metadata?.namespace ?? "default";
  const name = workload.metadata?.name ?? "";
  return {
    id: `local-kubernetes:${kind}:${namespace}:${name}`,
    provider: "local_kubernetes",
    kind,
    name,
    namespace,
    clusterName,
    labels: labelsOf(workload),
    selectors: workload.spec?.selector?.matchLabels ?? {},
    containers: (workload.spec?.template?.spec?.containers ?? []).map((container: any) => container.name).filter(Boolean),
    replicas: workload.spec?.replicas,
    readyReplicas: workload.status?.readyReplicas,
    availableReplicas: workload.status?.availableReplicas,
  };
}

export function parseKubernetesLogLine(line: string): { timestamp: string; message: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
  if (!match) return { timestamp: "", message: line };
  return { timestamp: match[1], message: match[2] };
}

function classifyKubernetesError(error: any): Pick<LocalKubernetesStatus, "code" | "error"> {
  const status = Number(error?.statusCode ?? error?.code ?? error?.response?.statusCode ?? 0);
  const message = error?.body?.message || error?.message || String(error);
  if (error?.code === "missing_file") return { code: "missing_file", error: message };
  if (error?.code === "bad_context") return { code: "bad_context", error: message };
  if (status === 401 || status === 403) return { code: "unauthorized", error: `Kubernetes API rejected this context: ${message}` };
  if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT") || message.includes("ENOTFOUND")) {
    return { code: "unreachable", error: `Kubernetes API is unreachable: ${message}` };
  }
  return { code: "unknown", error: message };
}

export async function getLocalKubernetesStatus(config: LocalKubernetesConfig): Promise<LocalKubernetesStatus> {
  const normalized = normalizeLocalKubernetesConfig(config);
  const kubeconfigPath = expandKubeconfigPath(normalized.kubeconfigPath);
  if (!normalized.enabled) {
    return {
      ok: false,
      enabled: false,
      kubeconfigPath,
      context: normalized.context,
      namespace: normalized.namespace,
      clusterName: "",
      serverUrl: "",
      kubernetesVersion: "",
      nodeCount: 0,
      namespaceCount: 0,
      code: "disabled",
      error: "Local Kubernetes source is disabled.",
    };
  }

  try {
    const kc = loadLocalKubeConfig(normalized);
    const core = kc.makeApiClient(k8s.CoreV1Api) as any;
    const versionApi = kc.makeApiClient(k8s.VersionApi) as any;
    const [version, nodes, namespaces] = await Promise.all([
      versionApi.getCode(),
      core.listNode(),
      core.listNamespace(),
    ]);

    return {
      ok: true,
      enabled: true,
      kubeconfigPath,
      context: kc.getCurrentContext(),
      namespace: normalized.namespace,
      clusterName: getClusterName(kc),
      serverUrl: kc.getCurrentCluster()?.server ?? "",
      kubernetesVersion: version.gitVersion ?? "",
      nodeCount: nodes.items?.length ?? 0,
      namespaceCount: namespaces.items?.length ?? 0,
    };
  } catch (error: any) {
    const classified = classifyKubernetesError(error);
    return {
      ok: false,
      enabled: normalized.enabled,
      kubeconfigPath,
      context: normalized.context,
      namespace: normalized.namespace,
      clusterName: "",
      serverUrl: "",
      kubernetesVersion: "",
      nodeCount: 0,
      namespaceCount: 0,
      ...classified,
    };
  }
}

async function listForNamespaces<T>(
  namespaces: string[],
  namespaceFilter: string,
  allNamespacesCall: () => Promise<{ items?: T[] }>,
  namespacedCall: (namespace: string) => Promise<{ items?: T[] }>,
): Promise<T[]> {
  if (!namespaceFilter) return (await allNamespacesCall()).items ?? [];
  const results = await Promise.all(namespaces.map((namespace) => namespacedCall(namespace).then((list) => list.items ?? [])));
  return results.flat();
}

export async function getLocalKubernetesResources(config: LocalKubernetesConfig): Promise<LocalKubernetesResourcesResponse> {
  const status = await getLocalKubernetesStatus(config);
  if (!status.ok) return { provider: "local_kubernetes", cluster: status, resources: [] };

  const kc = loadLocalKubeConfig(config);
  const core = kc.makeApiClient(k8s.CoreV1Api) as any;
  const apps = kc.makeApiClient(k8s.AppsV1Api) as any;
  const namespaceFilter = config.namespace.trim();
  const namespaceList = await core.listNamespace();
  const namespaceNames = (namespaceList.items ?? [])
    .map((namespace: any) => namespace.metadata?.name)
    .filter(Boolean)
    .filter((namespace: string) => !namespaceFilter || namespace === namespaceFilter);

  const [pods, services, deployments, daemonsets, statefulsets] = await Promise.all([
    listForNamespaces(namespaceNames, namespaceFilter, () => core.listPodForAllNamespaces({}), (namespace: string) => core.listNamespacedPod({ namespace })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((namespace: string) => core.listNamespacedService({ namespace })));
      return { items: lists.flatMap((list: any) => list.items ?? []) };
    }, (namespace: string) => core.listNamespacedService({ namespace })),
    listForNamespaces(namespaceNames, namespaceFilter, () => apps.listDeploymentForAllNamespaces({}), (namespace: string) => apps.listNamespacedDeployment({ namespace })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((namespace: string) => apps.listNamespacedDaemonSet({ namespace })));
      return { items: lists.flatMap((list: any) => list.items ?? []) };
    }, (namespace: string) => apps.listNamespacedDaemonSet({ namespace })),
    listForNamespaces(namespaceNames, namespaceFilter, async () => {
      const lists = await Promise.all(namespaceNames.map((namespace: string) => apps.listNamespacedStatefulSet({ namespace })));
      return { items: lists.flatMap((list: any) => list.items ?? []) };
    }, (namespace: string) => apps.listNamespacedStatefulSet({ namespace })),
  ]);

  const clusterResource: LocalKubernetesResource = {
    id: `local-kubernetes:cluster:${status.clusterName}`,
    provider: "local_kubernetes",
    kind: "cluster",
    name: status.clusterName,
    clusterName: status.clusterName,
    labels: {},
  };
  const namespaceResources = namespaceNames.map((namespace: string) => ({
    id: `local-kubernetes:namespace:${namespace}`,
    provider: "local_kubernetes" as const,
    kind: "namespace" as const,
    name: namespace,
    namespace,
    clusterName: status.clusterName,
    labels: {},
  }));

  return {
    provider: "local_kubernetes",
    cluster: status,
    resources: [
      clusterResource,
      ...namespaceResources,
      ...deployments.map((item: any) => normalizeKubernetesWorkload(item, "deployment", status.clusterName)),
      ...daemonsets.map((item: any) => normalizeKubernetesWorkload(item, "daemonset", status.clusterName)),
      ...statefulsets.map((item: any) => normalizeKubernetesWorkload(item, "statefulset", status.clusterName)),
      ...services.map((item: any) => normalizeKubernetesService(item, status.clusterName)),
      ...pods.map((item: any) => normalizeKubernetesPod(item, status.clusterName)),
    ],
  };
}

export async function getLocalKubernetesLogs(config: LocalKubernetesConfig, options: {
  namespace?: string;
  pod?: string;
  deployment?: string;
  app?: string;
  container?: string;
  after?: string;
  search?: string;
  limit?: number;
}): Promise<LocalKubernetesLogEntry[]> {
  const normalized = normalizeLocalKubernetesConfig(config);
  if (!normalized.enabled) return [];

  const kc = loadLocalKubeConfig(normalized);
  const core = kc.makeApiClient(k8s.CoreV1Api) as any;
  const namespace = options.namespace || normalized.namespace || "default";
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const afterMs = options.after ? Date.parse(options.after) : 0;
  const sinceSeconds = afterMs > 0 ? Math.max(1, Math.ceil((Date.now() - afterMs) / 1000) + 5) : undefined;

  let pods: any[] = [];
  if (options.pod) {
    const list = await core.listNamespacedPod({ namespace, fieldSelector: `metadata.name=${options.pod}` });
    pods = list.items ?? [];
  } else {
    const selectors: string[] = [];
    if (options.app) selectors.push(`app=${options.app}`);
    if (options.deployment) selectors.push(`app=${options.deployment}`, `app.kubernetes.io/name=${options.deployment}`);
    const podLists = selectors.length > 0
      ? await Promise.all(selectors.map((labelSelector) => core.listNamespacedPod({ namespace, labelSelector }).catch(() => ({ items: [] }))))
      : [await core.listNamespacedPod({ namespace })];
    const seen = new Set<string>();
    pods = podLists.flatMap((list: any) => list.items ?? []).filter((pod: any) => {
      const key = pod.metadata?.uid || pod.metadata?.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      if (!options.deployment) return true;
      return String(pod.metadata?.name ?? "").startsWith(`${options.deployment}-`) ||
        pod.metadata?.labels?.app === options.deployment ||
        pod.metadata?.labels?.["app.kubernetes.io/name"] === options.deployment;
    });
  }

  const entries: LocalKubernetesLogEntry[] = [];
  await Promise.all(pods.map(async (pod) => {
    const containers = options.container
      ? [options.container]
      : (pod.spec?.containers ?? []).map((container: any) => container.name).filter(Boolean);
    await Promise.all(containers.map(async (container: string) => {
      const raw = await core.readNamespacedPodLog({
        name: pod.metadata?.name,
        namespace,
        container,
        sinceSeconds,
        tailLines: limit,
        timestamps: true,
      }).catch(() => "");
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
          labels: labelsOf(pod),
          sourceProvider: "local_kubernetes",
        });
      }
    }));
  }));

  return entries
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}
