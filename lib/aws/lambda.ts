import { LambdaClient, ListFunctionsCommand, GetPolicyCommand, ListFunctionUrlConfigsCommand } from "@aws-sdk/client-lambda";
import { useMockAwsData, getAwsRegions, logAwsWarning, getAwsClientOptions, type AwsCredentials } from "./client";
import type { AwsLambdaFunction, AwsIamStatement } from "./types";

async function getMockLambdaFunctions(): Promise<AwsLambdaFunction[]> {
  const data = await import("@/fixtures/aws/lambda-functions.json");
  return data.default as AwsLambdaFunction[];
}

async function getRealLambdaFunctions(creds?: AwsCredentials): Promise<AwsLambdaFunction[]> {
  const regions = getAwsRegions();
  console.info("[aws/lambda] scanning regions", { regions });
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
            let functionUrl: string | undefined;
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
            } catch { }

            try {
              const urlsRes = await client.send(new ListFunctionUrlConfigsCommand({ FunctionName: functionName }));
              functionUrl = urlsRes.FunctionUrlConfigs?.[0]?.FunctionUrl;
            } catch { }

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
              functionUrl,
              resourcePolicy,
              vpcConfig: fn.VpcConfig?.VpcId
                ? {
                  vpcId: fn.VpcConfig.VpcId,
                  subnetIds: fn.VpcConfig.SubnetIds ?? [],
                  securityGroupIds: fn.VpcConfig.SecurityGroupIds ?? [],
                }
                : undefined,
              tags: {},
              envVars: fn.Environment?.Variables ?? undefined,
            };
          })
        );

        for (const r of withPolicies) {
          if (r.status === "fulfilled") functions.push(r.value);
          else logAwsWarning("lambda", `${region}/fn`, r.reason);
        }

        marker = res.NextMarker;
      } while (marker);

      console.info("[aws/lambda] region complete", {
        region,
        functions: functions.length,
        withFunctionUrl: functions.filter((fn) => Boolean(fn.functionUrl)).length,
        samples: functions.slice(0, 3).map((fn) => ({
          functionName: fn.functionName,
          state: fn.state,
          hasFunctionUrl: Boolean(fn.functionUrl),
        })),
      });
      return functions;
    })
  );

  const loaded = results
    .filter((r, i): r is PromiseFulfilledResult<AwsLambdaFunction[]> => {
      if (r.status === "rejected") logAwsWarning("lambda", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
  console.info("[aws/lambda] scan complete", {
    regions: regions.length,
    functions: loaded.length,
    withFunctionUrl: loaded.filter((fn) => Boolean(fn.functionUrl)).length,
  });
  return loaded;
}

export async function getLambdaFunctions(creds?: AwsCredentials, forceMock?: boolean): Promise<AwsLambdaFunction[]> {
  if (useMockAwsData(forceMock)) return getMockLambdaFunctions();
  return getRealLambdaFunctions(creds);
}
