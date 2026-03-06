import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { GcpLoadBalancer } from "./types";

async function getMockLoadBalancers(): Promise<GcpLoadBalancer[]> {
    // Return empty for now, can add fixtures later
    return [];
}

async function getRealLoadBalancers(projectIds: string[]): Promise<GcpLoadBalancer[]> {
    initGoogleAuth();
    const compute = google.compute("v1");

    const results = await Promise.allSettled(
        projectIds.map(async (projectId) => {
            const lbs: GcpLoadBalancer[] = [];

            // 1. Global Forwarding Rules
            try {
                const globalRes = await compute.globalForwardingRules.list({ project: projectId });
                for (const rule of globalRes.data.items ?? []) {
                    lbs.push({
                        name: rule.name ?? "",
                        projectId,
                        ipAddress: rule.IPAddress ?? undefined,
                        type: "Global HTTP(S)",
                        description: rule.description ?? undefined
                    });
                }
            } catch (err) {
                console.warn(`Failed to fetch global LBs for ${projectId}`);
            }

            // 2. Regional Forwarding Rules (Aggregated)
            try {
                const regionalRes = await compute.forwardingRules.aggregatedList({ project: projectId });
                for (const [regionKey, regionData] of Object.entries(regionalRes.data.items ?? {})) {
                    const region = regionKey.replace("regions/", "");
                    for (const rule of regionData.forwardingRules ?? []) {
                        lbs.push({
                            name: rule.name ?? "",
                            projectId,
                            region,
                            ipAddress: rule.IPAddress ?? undefined,
                            type: rule.loadBalancingScheme ?? "Regional",
                            description: rule.description ?? undefined
                        });
                    }
                }
            } catch (err) {
                console.warn(`Failed to fetch regional LBs for ${projectId}`);
            }

            return lbs;
        })
    );

    return results
        .filter((r, i): r is PromiseFulfilledResult<GcpLoadBalancer[]> => {
            if (r.status === "rejected") logFetchWarning("loadbalancing", projectIds[i], r.reason);
            return r.status === "fulfilled";
        })
        .flatMap((r) => r.value);
}

export async function getLoadBalancers(
    projectIds: string[],
    forceMock?: boolean
): Promise<GcpLoadBalancer[]> {
    if (useMockData(forceMock)) return getMockLoadBalancers();
    return getRealLoadBalancers(projectIds);
}
