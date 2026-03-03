import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsRdsInstance } from "./types";

async function getMockRdsInstances(): Promise<AwsRdsInstance[]> {
  const data = await import("@/fixtures/aws/rds-instances.json");
  return data.default as AwsRdsInstance[];
}

async function getRealRdsInstances(creds?: AwsCredentials): Promise<AwsRdsInstance[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new RDSClient(getAwsClientOptions(region, creds));
      const instances: AwsRdsInstance[] = [];
      let marker: string | undefined;

      do {
        const res = await client.send(
          new DescribeDBInstancesCommand({ Marker: marker })
        );
        for (const db of res.DBInstances ?? []) {
          const accountId = db.DBInstanceArn!.split(":")[4];
          instances.push({
            dbInstanceIdentifier: db.DBInstanceIdentifier!,
            accountId,
            region,
            dbInstanceArn: db.DBInstanceArn!,
            dbEngine: db.Engine ?? "unknown",
            dbEngineVersion: db.EngineVersion ?? "unknown",
            dbInstanceClass: db.DBInstanceClass ?? "unknown",
            dbInstanceStatus: db.DBInstanceStatus ?? "unknown",
            publiclyAccessible: db.PubliclyAccessible ?? false,
            multiAz: db.MultiAZ ?? false,
            storageEncrypted: db.StorageEncrypted ?? false,
            backupRetentionPeriod: db.BackupRetentionPeriod ?? 0,
            endpoint: db.Endpoint
              ? { address: db.Endpoint.Address!, port: db.Endpoint.Port! }
              : undefined,
            vpcId: db.DBSubnetGroup?.VpcId,
            securityGroupIds: (db.VpcSecurityGroups ?? []).map((sg) => sg.VpcSecurityGroupId!),
            tags: Object.fromEntries(
              (db.TagList ?? []).map((t) => [t.Key!, t.Value!])
            ),
            deletionProtection: db.DeletionProtection ?? false,
          });
        }
        marker = res.Marker;
      } while (marker);

      return instances;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsRdsInstance[]> => {
      if (r.status === "rejected") logAwsWarning("rds", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getRdsInstances(creds?: AwsCredentials): Promise<AwsRdsInstance[]> {
  if (useMockAwsData()) return getMockRdsInstances();
  return getRealRdsInstances(creds);
}
