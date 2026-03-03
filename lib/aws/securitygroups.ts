import { EC2Client, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { useMockAwsData, getAwsRegions, logAwsWarning } from "./client";
import type { AwsSecurityGroup, AwsSgRule } from "./types";

async function getMockSecurityGroups(): Promise<AwsSecurityGroup[]> {
  const data = await import("@/fixtures/aws/security-groups.json");
  return data.default as AwsSecurityGroup[];
}

function mapRules(permissions: Array<{
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string; Description?: string }>;
  Ipv6Ranges?: Array<{ CidrIpv6?: string; Description?: string }>;
}>): AwsSgRule[] {
  return permissions.map((perm): AwsSgRule => ({
    protocol: perm.IpProtocol ?? "-1",
    fromPort: perm.FromPort,
    toPort: perm.ToPort,
    cidrRanges: (perm.IpRanges ?? []).map((r) => r.CidrIp ?? ""),
    ipv6CidrRanges: (perm.Ipv6Ranges ?? []).map((r) => r.CidrIpv6 ?? ""),
    description: perm.IpRanges?.[0]?.Description,
  }));
}

async function getRealSecurityGroups(): Promise<AwsSecurityGroup[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new EC2Client({ region });
      const sgs: AwsSecurityGroup[] = [];
      let nextToken: string | undefined;

      do {
        const res = await client.send(
          new DescribeSecurityGroupsCommand({ MaxResults: 1000, NextToken: nextToken })
        );
        for (const sg of res.SecurityGroups ?? []) {
          sgs.push({
            groupId: sg.GroupId!,
            groupName: sg.GroupName!,
            accountId: sg.OwnerId ?? "unknown",
            region,
            vpcId: sg.VpcId ?? "",
            description: sg.Description ?? "",
            inboundRules: mapRules(sg.IpPermissions ?? []),
            outboundRules: mapRules(sg.IpPermissionsEgress ?? []),
            tags: Object.fromEntries(
              (sg.Tags ?? []).map((t) => [t.Key!, t.Value!])
            ),
          });
        }
        nextToken = res.NextToken;
      } while (nextToken);

      return sgs;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsSecurityGroup[]> => {
      if (r.status === "rejected") logAwsWarning("securitygroups", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getSecurityGroups(): Promise<AwsSecurityGroup[]> {
  if (useMockAwsData()) return getMockSecurityGroups();
  return getRealSecurityGroups();
}
