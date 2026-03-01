import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { FirewallRule } from "./types";

async function getMockFirewallRules(): Promise<FirewallRule[]> {
  const data = await import("@/fixtures/firewall-rules.json");
  return data.default as FirewallRule[];
}

async function getRealFirewallRules(projectIds: string[]): Promise<FirewallRule[]> {
  initGoogleAuth();
  const compute = google.compute("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await compute.firewalls.list({ project: projectId });
      return (res.data.items ?? []).map((rule): FirewallRule => ({
        name: rule.name ?? "",
        projectId,
        network: rule.network ?? "",
        direction: (rule.direction as "INGRESS" | "EGRESS") ?? "INGRESS",
        priority: rule.priority ?? 1000,
        sourceRanges: rule.sourceRanges ?? [],
        targetTags: rule.targetTags ?? [],
        allowed: (rule.allowed ?? []).map((a) => ({
          IPProtocol: a.IPProtocol ?? "",
          ports: a.ports ?? [],
        })),
        disabled: rule.disabled ?? false,
      }));
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<FirewallRule[]> => {
      if (r.status === "rejected") logFetchWarning("firewall", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getFirewallRules(projectIds: string[]): Promise<FirewallRule[]> {
  if (useMockData()) return getMockFirewallRules();
  return getRealFirewallRules(projectIds);
}
