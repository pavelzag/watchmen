import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsEc2Instance } from "./types";

async function getMockEc2Instances(): Promise<AwsEc2Instance[]> {
  const data = await import("@/fixtures/aws/ec2-instances.json");
  return data.default as AwsEc2Instance[];
}

async function getRealEc2Instances(creds?: AwsCredentials): Promise<AwsEc2Instance[]> {
  const regions = getAwsRegions();
  console.info("[aws/ec2] scanning regions", { regions });
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new EC2Client(getAwsClientOptions(region, creds));
      const instances: AwsEc2Instance[] = [];
      let nextToken: string | undefined;

      do {
        const res = await client.send(
          new DescribeInstancesCommand({ MaxResults: 1000, NextToken: nextToken })
        );
        for (const reservation of res.Reservations ?? []) {
          const accountId = reservation.OwnerId ?? "unknown";
          for (const inst of reservation.Instances ?? []) {
            instances.push({
              instanceId: inst.InstanceId!,
              accountId,
              region,
              instanceType: inst.InstanceType ?? "unknown",
              state: inst.State?.Name ?? "unknown",
              publicIpAddress: inst.PublicIpAddress ?? null,
              privateIpAddress: inst.PrivateIpAddress ?? "",
              iamInstanceProfileArn: inst.IamInstanceProfile?.Arn ?? null,
              securityGroupIds: (inst.SecurityGroups ?? []).map((sg) => sg.GroupId!),
              vpcId: inst.VpcId,
              subnetId: inst.SubnetId,
              imageId: inst.ImageId ?? "",
              launchTime: inst.LaunchTime?.toISOString() ?? "",
              tags: Object.fromEntries(
                (inst.Tags ?? []).map((t) => [t.Key!, t.Value!])
              ),
            });
          }
        }
        nextToken = res.NextToken;
      } while (nextToken);

      console.info("[aws/ec2] region complete", {
        region,
        instances: instances.length,
        running: instances.filter((instance) => instance.state === "running").length,
        withPublicIp: instances.filter((instance) => Boolean(instance.publicIpAddress)).length,
        traceable: instances.filter((instance) => instance.state === "running" && Boolean(instance.publicIpAddress)).length,
        samples: instances.slice(0, 3).map((instance) => ({
          instanceId: instance.instanceId,
          state: instance.state,
          hasPublicIp: Boolean(instance.publicIpAddress),
          name: instance.tags.Name,
        })),
      });
      return instances;
    })
  );

  const loaded = results
    .filter((r, i): r is PromiseFulfilledResult<AwsEc2Instance[]> => {
      if (r.status === "rejected") logAwsWarning("ec2", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
  console.info("[aws/ec2] scan complete", {
    regions: regions.length,
    instances: loaded.length,
    traceable: loaded.filter((instance) => instance.state === "running" && Boolean(instance.publicIpAddress)).length,
  });
  return loaded;
}

export async function getEc2Instances(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsEc2Instance[]> {
  if (useMockAwsData(forceMock)) return getMockEc2Instances();
  return getRealEc2Instances(creds);
}
