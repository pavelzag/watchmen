/**
 * Discovers external entry points into GKE clusters purely from GCP APIs.
 *
 * Chain for L4 LoadBalancer services (most common):
 *   ForwardingRule.backendService → BackendService.backends[].group
 *   → InstanceGroup name "gke-<cluster>-<pool>-<hash>-grp"
 *
 * Chain for legacy TCP load balancer (target pools — created by kube-proxy for
 * standard GKE clusters without container-native LB):
 *   ForwardingRule.target → TargetPool.instances[] (instance URLs containing
 *   "gke-<cluster>-") and TargetPool.description → {"kubernetes.io/service-name"}
 *
 * Chain for L7 Ingress / container-native load balancing:
 *   NEG.description (JSON) → cluster-name + namespace + service-name
 *   → BackendService.backends[].group (NEG reference)
 *   → ForwardingRule.backendService
 *
 * Master API endpoint is captured directly from the cluster object.
 */

import { google } from "googleapis";
import type { GkeCluster, GkeEntryPoint } from "./types";

function parseDesc(d?: string | null): Record<string, string> | null {
  if (!d) return null;
  try { return JSON.parse(d); } catch { return null; }
}

/** Resource self-link or URL → last path segment (the name). */
function lastName(url?: string | null): string {
  return url?.split("/").pop() ?? "";
}

function hasHealthyStatus(healthStatus?: Array<{ healthState?: string | null }>): boolean {
  return (healthStatus ?? []).some((status) => status.healthState === "HEALTHY");
}

async function backendServiceHasHealthyBackend(
  compute: ReturnType<typeof google.compute>,
  projectId: string,
  backendService: any,
): Promise<boolean> {
  const groups = (backendService.backends ?? [])
    .map((backend: any) => backend.group)
    .filter((group: unknown): group is string => typeof group === "string" && group.length > 0);

  if (groups.length === 0) return false;

  let checked = 0;
  for (const group of groups) {
    try {
      const region = lastName(backendService.region);
      const res = region
        ? await compute.regionBackendServices.getHealth({
            project: projectId,
            region,
            backendService: backendService.name,
            requestBody: { group },
          })
        : await compute.backendServices.getHealth({
            project: projectId,
            backendService: backendService.name,
            requestBody: { group },
          });
      checked += 1;
      if (hasHealthyStatus(res.data.healthStatus)) return true;
    } catch {
      // Some LB variants or IAM scopes do not expose health. In that case,
      // keep the endpoint rather than hiding a potentially valid target.
    }
  }

  return checked === 0;
}

async function targetPoolHasHealthyInstance(
  compute: ReturnType<typeof google.compute>,
  projectId: string,
  region: string,
  targetPool: any,
): Promise<boolean> {
  const instances = (targetPool?.instances ?? [])
    .filter((instance: unknown): instance is string => typeof instance === "string" && instance.length > 0);

  if (instances.length === 0) return false;

  let checked = 0;
  for (const instance of instances) {
    try {
      const res = await compute.targetPools.getHealth({
        project: projectId,
        region,
        targetPool: targetPool.name,
        requestBody: { instance },
      });
      checked += 1;
      if (hasHealthyStatus(res.data.healthStatus)) return true;
    } catch {
      // Preserve existing behavior when health checks cannot be read.
    }
  }

  return checked === 0;
}

export async function getClusterEntryPoints(
  clusters: GkeCluster[],
): Promise<GkeEntryPoint[]> {
  if (clusters.length === 0) return [];

  // Auth is already initialized by the calling route — do not reinitialize here.
  const compute = google.compute("v1");
  const results: GkeEntryPoint[] = [];

  const projectIds = [...new Set(clusters.map((c) => c.projectId))];

  for (const projectId of projectIds) {
    const projectClusters = clusters.filter((c) => c.projectId === projectId);

    // ── 1. Master API endpoints ───────────────────────────────────────
    for (const cluster of projectClusters) {
      results.push({
        clusterName: cluster.name,
        projectId,
        type: "master-api",
        ip: cluster.endpoint,
        k8sService: "Kubernetes API Server",
        isPublic: !cluster.privateCluster && !!cluster.endpoint,
      });
    }

    // ── 2. Fetch all forwarding rules (global + regional) ─────────────
    const forwardingRules: any[] = [];
    try {
      const gr = await compute.globalForwardingRules.list({ project: projectId });
      for (const r of gr.data.items ?? []) forwardingRules.push(r);
    } catch { /* no global FRs or API not enabled */ }

    try {
      const rr = await compute.forwardingRules.aggregatedList({ project: projectId });
      for (const [, data] of Object.entries(rr.data.items ?? {})) {
        for (const r of (data as any).forwardingRules ?? []) forwardingRules.push(r);
      }
    } catch { /* no regional FRs */ }

    // ── 3. Fetch all backend services ─────────────────────────────────
    const backendServices: any[] = [];
    try {
      const gb = await compute.backendServices.aggregatedList({ project: projectId });
      for (const [, data] of Object.entries(gb.data.items ?? {})) {
        for (const bs of (data as any).backendServices ?? []) backendServices.push(bs);
      }
    } catch { /* no backend services */ }

    // ── 4. Fetch Network Endpoint Groups ──────────────────────────────
    const negs: any[] = [];
    try {
      const nr = await compute.networkEndpointGroups.aggregatedList({ project: projectId });
      for (const [, data] of Object.entries(nr.data.items ?? {})) {
        for (const neg of (data as any).networkEndpointGroups ?? []) negs.push(neg);
      }
    } catch { /* no NEGs */ }

    // ── 5. Build lookup maps ──────────────────────────────────────────

    // backendService selfLink → forwarding rule with external IP
    const bsToFR = new Map<string, any>();
    // targetPool selfLink/name → forwarding rule with external IP
    const tpToFR = new Map<string, any>();
    for (const fr of forwardingRules) {
      if (fr.backendService) {
        bsToFR.set(fr.backendService, fr);
        bsToFR.set(lastName(fr.backendService), fr);
      }
      if (fr.target && fr.target.includes("/targetPools/")) {
        tpToFR.set(fr.target, fr);
        tpToFR.set(lastName(fr.target), fr);
      }
    }

    // NEG name → GKE cluster+service info from description JSON
    // GKE sets: {"cluster-uid":"...","cluster-name":"X","namespace":"Y","service-name":"Z","port":"80"}
    const negToGke = new Map<string, { clusterName: string; namespace: string; service: string; port: string }>();
    for (const neg of negs) {
      const d = parseDesc(neg.description);
      if (d?.["cluster-name"]) {
        negToGke.set(neg.name, {
          clusterName: d["cluster-name"],
          namespace: d["namespace"] ?? "",
          service: d["service-name"] ?? "",
          port: d["port"] ?? "",
        });
      }
    }

    // ── 6. Fetch target pools and match to clusters (legacy TCP LB) ──────
    const seen = new Set<string>(); // deduplicate on (cluster, ip, k8sService)

    if (tpToFR.size > 0) {
      // Collect unique target pool names referenced by forwarding rules
      const tpNames = [...new Set(
        forwardingRules
          .filter(fr => fr.target?.includes("/targetPools/"))
          .map(fr => ({ name: lastName(fr.target), region: lastName(fr.region) }))
      )];

      for (const { name: tpName, region } of tpNames) {
        let tp: any = null;
        try {
          const r = await compute.targetPools.get({ project: projectId, region, targetPool: tpName });
          tp = r.data;
        } catch { continue; }

        const fr = tpToFR.get(tpName) ?? tpToFR.get(tp?.selfLink);
        const ip: string | undefined = fr?.IPAddress ?? undefined;
        const desc = parseDesc(tp?.description);
        const k8sService: string | undefined = desc?.["kubernetes.io/service-name"] ?? undefined;

        for (const cluster of projectClusters) {
          const clusterPrefix = `gke-${cluster.name}-`;
          const hasClusterInstance = (tp?.instances ?? []).some(
            (inst: string) => inst.split("/instances/").pop()?.startsWith(clusterPrefix),
          );
          if (!hasClusterInstance) continue;

          const key = `${cluster.name}|${ip ?? ""}|${k8sService ?? tpName}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const hasHealthyBackend = await targetPoolHasHealthyInstance(compute, projectId, region, tp);
          if (!hasHealthyBackend) continue;

          results.push({
            clusterName: cluster.name,
            projectId,
            type: "lb-service",
            ip,
            lbName: fr?.name ?? tpName,
            k8sService,
            isPublic: !!ip,
          });
        }
      }
    }

    // ── 7. Match backend services → clusters ──────────────────────────

    for (const bs of backendServices) {
      const desc = parseDesc(bs.description);
      const k8sServiceAnnotation = desc?.["kubernetes.io/service-name"]; // "namespace/service"

      // Find associated forwarding rule → external IP
      const fr = bsToFR.get(bs.selfLink) ?? bsToFR.get(bs.name);
      const ip: string | undefined = fr?.IPAddress ?? undefined;

      for (const cluster of projectClusters) {
        const clusterPrefix = `gke-${cluster.name}`;
        let matched = false;
        let k8sService = k8sServiceAnnotation;
        let type: GkeEntryPoint["type"] = "lb-service";

        // L4: instance group name contains cluster name
        const hasInstanceGroupBackend = (bs.backends ?? []).some(
          (b: any) => typeof b.group === "string" && b.group.includes(clusterPrefix),
        );

        if (hasInstanceGroupBackend) matched = true;

        // L7 (Ingress/NEG): NEG description references cluster name
        if (!matched) {
          const negBackend = (bs.backends ?? []).find((b: any) => {
            const negName = lastName(b.group);
            return negToGke.get(negName)?.clusterName === cluster.name;
          });
          if (negBackend) {
            matched = true;
            type = "ingress";
            const neg = negToGke.get(lastName(negBackend.group));
            if (neg && !k8sService) {
              k8sService = neg.namespace && neg.service
                ? `${neg.namespace}/${neg.service}`
                : undefined;
            }
          }
        }

        if (!matched) continue;

        const key = `${cluster.name}|${ip ?? ""}|${k8sService ?? bs.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const hasHealthyBackend = await backendServiceHasHealthyBackend(compute, projectId, bs);
        if (!hasHealthyBackend) continue;

        results.push({
          clusterName: cluster.name,
          projectId,
          type,
          ip,
          lbName: fr?.name ?? bs.name,
          k8sService,
          isPublic: !!ip,
        });
      }
    }
  }

  return results;
}
