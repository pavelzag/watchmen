import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsLoadBalancer } from "./types";

async function getMockLoadBalancers(): Promise<AwsLoadBalancer[]> {
    return [
        {
            name: "eks-watchmen-alb",
            accountId: "123456789012",
            region: "us-east-1",
            dnsName: "eks-watchmen-alb-123456789.us-east-1.elb.amazonaws.com",
            type: "application",
            scheme: "internet-facing",
            state: "active"
        },
        {
            name: "eks-processor-nlb",
            accountId: "123456789012",
            region: "us-west-2",
            dnsName: "eks-processor-nlb-987654321.us-west-2.elb.amazonaws.com",
            type: "network",
            scheme: "internet-facing",
            state: "active"
        }
    ];
}

async function getRealLoadBalancers(creds?: AwsCredentials): Promise<AwsLoadBalancer[]> {
    const regions = getAwsRegions();
    console.info("[aws/elb] scanning regions", { regions });
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

            console.info("[aws/elb] region complete", {
                region,
                loadBalancers: lbs.length,
                internetFacing: lbs.filter((lb) => lb.scheme === "internet-facing").length,
                withDnsName: lbs.filter((lb) => Boolean(lb.dnsName)).length,
                traceable: lbs.filter((lb) => lb.dnsName && lb.scheme === "internet-facing" && lb.state !== "failed").length,
                samples: lbs.slice(0, 3).map((lb) => ({
                    name: lb.name,
                    type: lb.type,
                    scheme: lb.scheme,
                    state: lb.state,
                    hasDnsName: Boolean(lb.dnsName),
                })),
            });
            return lbs;
        })
    );

    const loaded = results
        .filter((r, i): r is PromiseFulfilledResult<AwsLoadBalancer[]> => {
            if (r.status === "rejected") logAwsWarning("elb", regions[i], r.reason);
            return r.status === "fulfilled";
        })
        .flatMap((r) => r.value);
    console.info("[aws/elb] scan complete", {
        regions: regions.length,
        loadBalancers: loaded.length,
        traceable: loaded.filter((lb) => lb.dnsName && lb.scheme === "internet-facing" && lb.state !== "failed").length,
    });
    return loaded;
}

export async function getLoadBalancers(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsLoadBalancer[]> {
    if (useMockAwsData(forceMock)) return getMockLoadBalancers();
    return getRealLoadBalancers(creds);
}
