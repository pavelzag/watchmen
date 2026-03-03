import { RedshiftClient, DescribeClustersCommand } from "@aws-sdk/client-redshift";
import { useMockAwsData, getAwsRegions, logAwsWarning } from "./client";
import type { AwsRedshiftCluster } from "./types";

async function getMockRedshiftClusters(): Promise<AwsRedshiftCluster[]> {
  const data = await import("@/fixtures/aws/redshift-clusters.json");
  return data.default as AwsRedshiftCluster[];
}

async function getRealRedshiftClusters(): Promise<AwsRedshiftCluster[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new RedshiftClient({ region });
      const clusters: AwsRedshiftCluster[] = [];
      let marker: string | undefined;

      do {
        const res = await client.send(
          new DescribeClustersCommand({ Marker: marker })
        );
        for (const c of res.Clusters ?? []) {
          const arn = `arn:aws:redshift:${region}:${c.ClusterNamespaceArn?.split(":")[4] ?? "unknown"}:cluster:${c.ClusterIdentifier}`;
          const accountId = arn.split(":")[4];
          clusters.push({
            clusterIdentifier: c.ClusterIdentifier!,
            accountId,
            region,
            nodeType: c.NodeType ?? "unknown",
            numberOfNodes: c.NumberOfNodes ?? 1,
            clusterStatus: c.ClusterStatus ?? "unknown",
            masterUsername: c.MasterUsername ?? "",
            dbName: c.DBName ?? "",
            endpoint: c.Endpoint
              ? { address: c.Endpoint.Address!, port: c.Endpoint.Port! }
              : undefined,
            publiclyAccessible: c.PubliclyAccessible ?? false,
            encrypted: c.Encrypted ?? false,
            vpcId: c.VpcId,
            tags: Object.fromEntries(
              (c.Tags ?? []).map((t) => [t.Key!, t.Value!])
            ),
            createdAt: c.ClusterCreateTime?.toISOString(),
            enhancedVpcRouting: c.EnhancedVpcRouting ?? false,
          });
        }
        marker = res.Marker;
      } while (marker);

      return clusters;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsRedshiftCluster[]> => {
      if (r.status === "rejected") logAwsWarning("redshift", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getRedshiftClusters(): Promise<AwsRedshiftCluster[]> {
  if (useMockAwsData()) return getMockRedshiftClusters();
  return getRealRedshiftClusters();
}
