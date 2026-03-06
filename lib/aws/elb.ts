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
