import { google } from "googleapis";
import { initGoogleAuth, useMockData, logFetchWarning } from "./client";
import type { PubSubTopic } from "./types";

async function getMockPubSubTopics(): Promise<PubSubTopic[]> {
  const data = await import("@/fixtures/pubsub.json");
  return data.default as PubSubTopic[];
}

async function getRealPubSubTopics(projectIds: string[]): Promise<PubSubTopic[]> {
  initGoogleAuth();
  const pubsub = google.pubsub("v1");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await pubsub.projects.topics.list({
        project: `projects/${projectId}`,
      });
      const topics: PubSubTopic[] = [];

      for (const topic of res.data.topics ?? []) {
        let bindings: { role: string; members: string[] }[] = [];
        try {
          const iamRes = await pubsub.projects.topics.getIamPolicy({
            resource: topic.name ?? "",
          });
          bindings = (iamRes.data.bindings ?? []).map((b) => ({
            role: b.role ?? "",
            members: b.members ?? [],
          }));
        } catch {
          // ignore IAM fetch errors
        }

        topics.push({
          name: topic.name ?? "",
          projectId,
          iamPolicy: { bindings },
        });
      }
      return topics;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<PubSubTopic[]> => {
      if (r.status === "rejected") logFetchWarning("pubsub", projectIds[i], r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getPubSubTopics(
  projectIds: string[],
  forceMock?: boolean
): Promise<PubSubTopic[]> {
  if (useMockData(forceMock)) return getMockPubSubTopics();
  return getRealPubSubTopics(projectIds);
}
