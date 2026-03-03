import { EKSClient, ListClustersCommand, DescribeClusterCommand } from "@aws-sdk/client-eks";
import { useMockAwsData, getAwsRegions, logAwsWarning } from "./client";
import type { AwsEksCluster } from "./types";

async function getMockEksClusters(): Promise<AwsEksCluster[]> {
  const data = await import("@/fixtures/aws/eks-clusters.json");
  return data.default as AwsEksCluster[];
}

async function getRealEksClusters(): Promise<AwsEksCluster[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new EKSClient({ region });
      const listRes = await client.send(new ListClustersCommand({}));
      const names = listRes.clusters ?? [];

      const described = await Promise.allSettled(
        names.map(async (name): Promise<AwsEksCluster> => {
          const res = await client.send(new DescribeClusterCommand({ name }));
          const c = res.cluster!;
          const accountId = c.arn!.split(":")[4];
          return {
            clusterName: c.name!,
            accountId,
            region,
            arn: c.arn!,
            status: c.status ?? "UNKNOWN",
            kubernetesVersion: c.version ?? "unknown",
            roleArn: c.roleArn!,
            endpointPublicAccess: c.resourcesVpcConfig?.endpointPublicAccess ?? false,
            endpointPrivateAccess: c.resourcesVpcConfig?.endpointPrivateAccess ?? false,
            publicAccessCidrs: c.resourcesVpcConfig?.publicAccessCidrs ?? [],
            vpcId: c.resourcesVpcConfig?.vpcId ?? "",
            loggingEnabled: (c.logging?.clusterLogging ?? []).some((l) => l.enabled),
            tags: (c.tags as Record<string, string>) ?? {},
            createdAt: c.createdAt?.toISOString() ?? "",
          };
        })
      );

      return described
        .filter((r): r is PromiseFulfilledResult<AwsEksCluster> => {
          if (r.status === "rejected") logAwsWarning("eks", `${region}`, r.reason);
          return r.status === "fulfilled";
        })
        .map((r) => r.value);
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsEksCluster[]> => {
      if (r.status === "rejected") logAwsWarning("eks", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getEksClusters(): Promise<AwsEksCluster[]> {
  if (useMockAwsData()) return getMockEksClusters();
  return getRealEksClusters();
}
