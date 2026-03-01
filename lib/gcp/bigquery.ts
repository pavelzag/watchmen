import { google } from "googleapis";
import { initGoogleAuth, useMockData } from "./client";
import type { BigQueryDataset } from "./types";

async function getMockBigQueryDatasets(): Promise<BigQueryDataset[]> {
  const data = await import("@/fixtures/bigquery.json");
  return data.default as BigQueryDataset[];
}

async function getRealBigQueryDatasets(projectIds: string[]): Promise<BigQueryDataset[]> {
  initGoogleAuth();
  const bq = google.bigquery("v2");

  const results = await Promise.allSettled(
    projectIds.map(async (projectId) => {
      const res = await bq.datasets.list({ projectId });
      const datasets: BigQueryDataset[] = [];

      for (const ds of res.data.datasets ?? []) {
        const datasetId = ds.datasetReference?.datasetId ?? "";
        let bindings: { role: string; members: string[] }[] = [];
        try {
          const iamRes = await bq.datasets.get({ projectId, datasetId });
          bindings = (iamRes.data.access ?? []).map((entry) => ({
            role: entry.role ?? "",
            members: entry.userByEmail
              ? [`user:${entry.userByEmail}`]
              : entry.specialGroup
              ? [entry.specialGroup]
              : [],
          }));
        } catch {
          // ignore IAM fetch errors
        }

        datasets.push({
          datasetId,
          projectId,
          location: ds.location ?? "",
          iamPolicy: { bindings },
        });
      }
      return datasets;
    })
  );

  return results
    .filter((r, i): r is PromiseFulfilledResult<BigQueryDataset[]> => {
      if (r.status === "rejected") console.warn(`[bigquery] ${projectIds[i]} failed:`, r.reason);
      return r.status === "fulfilled";
    })
    .flatMap((r) => r.value);
}

export async function getBigQueryDatasets(projectIds: string[]): Promise<BigQueryDataset[]> {
  if (useMockData()) return getMockBigQueryDatasets();
  return getRealBigQueryDatasets(projectIds);
}
