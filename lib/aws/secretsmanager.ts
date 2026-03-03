import { SecretsManagerClient, ListSecretsCommand, GetResourcePolicyCommand, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsSecret, AwsIamStatement } from "./types";

async function getMockSecrets(): Promise<AwsSecret[]> {
  const data = await import("@/fixtures/aws/secrets.json");
  return data.default as AwsSecret[];
}

async function getRealSecrets(creds?: AwsCredentials): Promise<AwsSecret[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new SecretsManagerClient(getAwsClientOptions(region, creds));
      const secrets: AwsSecret[] = [];
      let nextToken: string | undefined;

      do {
        const res = await client.send(
          new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 })
        );

        const described = await Promise.allSettled(
          (res.SecretList ?? []).map(async (s): Promise<AwsSecret> => {
            const accountId = s.ARN!.split(":")[4];

            let resourcePolicy: AwsIamStatement[] = [];
            try {
              const policyRes = await client.send(
                new GetResourcePolicyCommand({ SecretId: s.ARN! })
              );
              if (policyRes.ResourcePolicy) {
                const doc = JSON.parse(policyRes.ResourcePolicy);
                resourcePolicy = (doc.Statement ?? []).map((st: Record<string, unknown>) => ({
                  effect: st.Effect as "Allow" | "Deny",
                  principals: Array.isArray(st.Principal)
                    ? st.Principal
                    : typeof st.Principal === "object" && st.Principal !== null
                      ? Object.values(st.Principal as Record<string, string[]>).flat()
                      : [String(st.Principal ?? "*")],
                  actions: Array.isArray(st.Action) ? st.Action : [String(st.Action ?? "*")],
                  resources: Array.isArray(st.Resource) ? st.Resource : [String(st.Resource ?? "*")],
                }));
              }
            } catch { }

            return {
              name: s.Name!,
              arn: s.ARN!,
              accountId,
              region,
              description: s.Description,
              createdDate: s.CreatedDate!.toISOString(),
              lastChangedDate: s.LastChangedDate?.toISOString(),
              lastAccessedDate: s.LastAccessedDate?.toISOString(),
              rotationEnabled: s.RotationEnabled ?? false,
              rotationLambdaArn: s.RotationLambdaARN,
              kmsKeyId: s.KmsKeyId,
              resourcePolicy,
              tags: Object.fromEntries(
                (s.Tags ?? []).map((t) => [t.Key!, t.Value!])
              ),
            };
          })
        );

        for (const r of described) {
          if (r.status === "fulfilled") secrets.push(r.value);
          else logAwsWarning("secretsmanager", `${region}/secret`, r.reason);
        }

        nextToken = res.NextToken;
      } while (nextToken);

      return secrets;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsSecret[]> => {
      if (r.status === "rejected") logAwsWarning("secretsmanager", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getSecrets(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsSecret[]> {
  if (useMockAwsData(forceMock)) return getMockSecrets();
  return getRealSecrets(creds);
}
