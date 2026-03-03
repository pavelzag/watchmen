import { LambdaClient, ListFunctionsCommand, GetPolicyCommand } from "@aws-sdk/client-lambda";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsLambdaFunction, AwsIamStatement } from "./types";

async function getMockLambdaFunctions(): Promise<AwsLambdaFunction[]> {
  const data = await import("@/fixtures/aws/lambda-functions.json");
  return data.default as AwsLambdaFunction[];
}

async function getRealLambdaFunctions(creds?: AwsCredentials): Promise<AwsLambdaFunction[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new LambdaClient(getAwsClientOptions(region, creds));
      const functions: AwsLambdaFunction[] = [];
      let marker: string | undefined;

      do {
        const res = await client.send(new ListFunctionsCommand({ Marker: marker }));
        const fns = res.Functions ?? [];

        const withPolicies = await Promise.allSettled(
          fns.map(async (fn): Promise<AwsLambdaFunction> => {
            const functionName = fn.FunctionName!;
            const accountId = fn.FunctionArn!.split(":")[4];

            let resourcePolicy: AwsIamStatement[] = [];
            try {
              const policyRes = await client.send(new GetPolicyCommand({ FunctionName: functionName }));
              if (policyRes.Policy) {
                const doc = JSON.parse(policyRes.Policy);
                resourcePolicy = (doc.Statement ?? []).map((s: Record<string, unknown>) => ({
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
            } catch {}

            return {
              functionName,
              functionArn: fn.FunctionArn!,
              accountId,
              region,
              runtime: fn.Runtime ?? "unknown",
              role: fn.Role ?? "",
              lastModified: fn.LastModified ?? "",
              codeSize: fn.CodeSize ?? 0,
              timeout: fn.Timeout ?? 3,
              memorySize: fn.MemorySize ?? 128,
              state: fn.State,
              resourcePolicy,
              vpcConfig: fn.VpcConfig?.VpcId
                ? {
                    vpcId: fn.VpcConfig.VpcId,
                    subnetIds: fn.VpcConfig.SubnetIds ?? [],
                    securityGroupIds: fn.VpcConfig.SecurityGroupIds ?? [],
                  }
                : undefined,
              tags: {},
            };
          })
        );

        for (const r of withPolicies) {
          if (r.status === "fulfilled") functions.push(r.value);
          else logAwsWarning("lambda", `${region}/fn`, r.reason);
        }

        marker = res.NextMarker;
      } while (marker);

      return functions;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsLambdaFunction[]> => {
      if (r.status === "rejected") logAwsWarning("lambda", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getLambdaFunctions(creds?: AwsCredentials): Promise<AwsLambdaFunction[]> {
  if (useMockAwsData()) return getMockLambdaFunctions();
  return getRealLambdaFunctions(creds);
}
