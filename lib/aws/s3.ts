import { S3Client, ListBucketsCommand, GetBucketLocationCommand, GetBucketPolicyCommand, GetBucketVersioningCommand, GetBucketEncryptionCommand, GetPublicAccessBlockCommand, GetBucketAclCommand, GetBucketTaggingCommand } from "@aws-sdk/client-s3";
import { useMockAwsData, logAwsWarning } from "./client";
import type { AwsS3Bucket, AwsIamStatement } from "./types";

async function getMockBuckets(): Promise<AwsS3Bucket[]> {
  const data = await import("@/fixtures/aws/s3-buckets.json");
  return data.default as unknown as AwsS3Bucket[];
}

async function getRealBuckets(): Promise<AwsS3Bucket[]> {
  const client = new S3Client({ region: "us-east-1" });
  const buckets: AwsS3Bucket[] = [];

  try {
    const listRes = await client.send(new ListBucketsCommand({}));
    const rawBuckets = listRes.Buckets ?? [];
    const accountId = listRes.Owner?.ID ?? "unknown";

    const settled = await Promise.allSettled(
      rawBuckets.map(async (b): Promise<AwsS3Bucket> => {
        const bucketName = b.Name!;

        let region = "us-east-1";
        try {
          const locRes = await client.send(new GetBucketLocationCommand({ Bucket: bucketName }));
          region = locRes.LocationConstraint ?? "us-east-1";
        } catch {}

        const regionalClient = new S3Client({ region });

        const [policyRes, versioningRes, encRes, pabRes, aclRes, tagsRes] =
          await Promise.allSettled([
            regionalClient.send(new GetBucketPolicyCommand({ Bucket: bucketName })),
            regionalClient.send(new GetBucketVersioningCommand({ Bucket: bucketName })),
            regionalClient.send(new GetBucketEncryptionCommand({ Bucket: bucketName })),
            regionalClient.send(new GetPublicAccessBlockCommand({ Bucket: bucketName })),
            regionalClient.send(new GetBucketAclCommand({ Bucket: bucketName })),
            regionalClient.send(new GetBucketTaggingCommand({ Bucket: bucketName })),
          ]);

        let bucketPolicy: AwsIamStatement[] = [];
        if (policyRes.status === "fulfilled" && policyRes.value.Policy) {
          const doc = JSON.parse(policyRes.value.Policy);
          bucketPolicy = (doc.Statement ?? []).map((s: Record<string, unknown>) => ({
            effect: s.Effect as "Allow" | "Deny",
            principals: Array.isArray(s.Principal)
              ? s.Principal
              : typeof s.Principal === "object" && s.Principal !== null
              ? Object.values(s.Principal as Record<string, string[]>).flat()
              : [String(s.Principal ?? "*")],
            actions: Array.isArray(s.Action) ? s.Action : [String(s.Action ?? "*")],
            resources: Array.isArray(s.Resource) ? s.Resource : [String(s.Resource ?? "*")],
          }));
        }

        const versioningStatus =
          versioningRes.status === "fulfilled"
            ? (versioningRes.value.Status as "Enabled" | "Suspended") ?? "Disabled"
            : "Disabled";

        let encryption: AwsS3Bucket["encryption"] = "None";
        if (encRes.status === "fulfilled") {
          const rules = encRes.value.ServerSideEncryptionConfiguration?.Rules ?? [];
          const sseAlg = rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
          if (sseAlg === "aws:kms") encryption = "SSE-KMS";
          else if (sseAlg === "AES256") encryption = "SSE-S3";
        }

        const pab = pabRes.status === "fulfilled" ? pabRes.value.PublicAccessBlockConfiguration : null;
        const publicAccessBlock = {
          blockPublicAcls: pab?.BlockPublicAcls ?? false,
          ignorePublicAcls: pab?.IgnorePublicAcls ?? false,
          blockPublicPolicy: pab?.BlockPublicPolicy ?? false,
          restrictPublicBuckets: pab?.RestrictPublicBuckets ?? false,
        };

        const aclGrant =
          aclRes.status === "fulfilled"
            ? aclRes.value.Grants?.find((g) => g.Grantee?.URI?.includes("AllUsers"))
            : undefined;
        const acl = aclGrant
          ? aclGrant.Permission === "WRITE"
            ? "public-read-write"
            : "public-read"
          : "private";

        const tags =
          tagsRes.status === "fulfilled"
            ? Object.fromEntries(
                (tagsRes.value.TagSet ?? []).map((t) => [t.Key!, t.Value!])
              )
            : {};

        return {
          bucketName,
          accountId,
          region,
          creationDate: b.CreationDate!.toISOString(),
          publicAccessBlock,
          bucketPolicy,
          versioning: versioningStatus,
          encryption,
          acl,
          tags,
        };
      })
    );

    for (const r of settled) {
      if (r.status === "fulfilled") buckets.push(r.value);
      else logAwsWarning("s3", "bucket", r.reason);
    }
  } catch (err) {
    logAwsWarning("s3", "list", err);
  }

  return buckets;
}

export async function getS3Buckets(): Promise<AwsS3Bucket[]> {
  if (useMockAwsData()) return getMockBuckets();
  return getRealBuckets();
}
