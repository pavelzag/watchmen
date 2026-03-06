import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsLoadBalancer } from "./types";

async function getMockLoadBalancers(): Promise<AwsLoadBalancer[]> {
    // Return empty for now, can add fixtures later
    return [];
}

async function getRealLoadBalancers(creds?: AwsCredentials): Promise<AwsLoadBalancer[]> {
    const regions = getAwsRegions();
    const results = await Promise.allSettled(
        regions.map(async (region) => {
            const client = new ElasticLoadBalancingV2Client(getAwsClientOptions(region, creds));
            const lbs: AwsLoadBalancer[] = [];
            let marker: string | undefined;

            do {
                const res = await client.send(new DescribeLoadBalancersCommand({ Marker: marker }));
                const items = res.LoadBalancers ?? [];

                for (const lb of items) {
                    lbs.push({
                        name: lb.LoadBalancerName ?? "",
                        accountId: lb.CanonicalHostedZoneId?.split(":")[0] ?? "unknown", // Heuristic or from Arn
                        region,
                        dnsName: lb.DNSName ?? "",
                        type: lb.Type ?? "application",
                        scheme: lb.Scheme === "internal" ? "internal" : "internet-facing",
                        state: lb.State?.Code ?? "active"
                    });
                }
                marker = res.NextMarker;
            } while (marker);

            return lbs;
        })
    );

    return results
        .filter((r, i): r is PromiseFulfilledResult<AwsLoadBalancer[]> => {
            if (r.status === "rejected") logAwsWarning("elb", regions[i], r.reason);
            return r.status === "fulfilled";
        })
        .flatMap((r) => r.value);
}

export async function getLoadBalancers(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsLoadBalancer[]> {
    if (useMockAwsData(forceMock)) return getMockLoadBalancers();
    return getRealLoadBalancers(creds);
}
