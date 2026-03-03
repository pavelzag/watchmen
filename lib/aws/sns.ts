import { SNSClient, ListTopicsCommand, GetTopicAttributesCommand, ListTagsForResourceCommand } from "@aws-sdk/client-sns";
import { useMockAwsData, getAwsRegions, logAwsWarning } from "./client";
import type { AwsSnsTopic, AwsIamStatement } from "./types";

async function getMockSnsTopics(): Promise<AwsSnsTopic[]> {
  const data = await import("@/fixtures/aws/sns-topics.json");
  return data.default as AwsSnsTopic[];
}

async function getRealSnsTopics(): Promise<AwsSnsTopic[]> {
  const regions = getAwsRegions();
  const results = await Promise.allSettled(
    regions.map(async (region) => {
      const client = new SNSClient({ region });
      const listRes = await client.send(new ListTopicsCommand({}));
      const topics = listRes.Topics ?? [];

      const described = await Promise.allSettled(
        topics.map(async (t): Promise<AwsSnsTopic> => {
          const topicArn = t.TopicArn!;
          const topicName = topicArn.split(":").pop()!;
          const accountId = topicArn.split(":")[4];

          const [attrRes, tagsRes] = await Promise.allSettled([
            client.send(new GetTopicAttributesCommand({ TopicArn: topicArn })),
            client.send(new ListTagsForResourceCommand({ ResourceArn: topicArn })),
          ]);

          let policy: AwsIamStatement[] = [];
          let subscriptionCount = 0;
          let kmsMasterKeyId: string | undefined;

          if (attrRes.status === "fulfilled") {
            const attrs = attrRes.value.Attributes ?? {};
            subscriptionCount = parseInt(attrs.SubscriptionsConfirmed ?? "0", 10);
            kmsMasterKeyId = attrs.KmsMasterKeyId || undefined;
            if (attrs.Policy) {
              const doc = JSON.parse(attrs.Policy);
              policy = (doc.Statement ?? []).map((s: Record<string, unknown>) => ({
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
          }

          const tags =
            tagsRes.status === "fulfilled"
              ? Object.fromEntries(
                  (tagsRes.value.Tags ?? []).map((tag) => [tag.Key!, tag.Value!])
                )
              : {};

          return {
            topicArn,
            topicName,
            accountId,
            region,
            policy,
            subscriptionCount,
            kmsMasterKeyId,
            tags,
          };
        })
      );

      return described
        .filter((r): r is PromiseFulfilledResult<AwsSnsTopic> => {
          if (r.status === "rejected") logAwsWarning("sns", `${region}`, r.reason);
          return r.status === "fulfilled";
        })
        .map((r) => r.value);
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<AwsSnsTopic[]> => {
      if (r.status === "rejected") logAwsWarning("sns", regions[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getSnsTopics(): Promise<AwsSnsTopic[]> {
  if (useMockAwsData()) return getMockSnsTopics();
  return getRealSnsTopics();
}
