import { google } from "googleapis";
import { initGoogleAuth, logFetchWarning, withProjectRetry } from "./client";
import {
  ImageScanResult,
  CveSeverity,
  GcpImageScanStatus,
} from "../container-scanning";

function mapSeverity(gcpSev: string): CveSeverity {
  switch (gcpSev?.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "negligible";
  }
}

export function normalizeImageUri(uri: string): string {
  return uri.trim().replace(/^https?:\/\//i, "");
}

function buildImageName(uri: string, tags?: string[] | null): string {
  const normalized = normalizeImageUri(uri);
  const parts = normalized.split("/");
  const lastSegment = parts[parts.length - 1] ?? normalized;
  const cleanTags = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (cleanTags.length > 0) {
    const baseName = lastSegment.split("@")[0] || lastSegment;
    const preferredTag = cleanTags.find((t) => t !== "latest") ?? cleanTags[0];
    return `${baseName}:${preferredTag}`;
  }
  return lastSegment;
}

function emptySummary() {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    negligible: 0,
  };
}

interface ArDockerImage {
  normUri: string;
  uri: string;
  imageName: string;
  scannedAt: string;
  imageUpdatedAt?: string;
}

interface DiscoveryState {
  analysisStatus?: string | null;
  lastScanTime?: string | null;
  errorMessage?: string | null;
}

async function listArtifactRegistryDockerImages(projectId: string): Promise<{
  images: ArDockerImage[];
  failed: boolean;
}> {
  if (typeof google.artifactregistry !== "function") {
    return { images: [], failed: false };
  }

  const ar = google.artifactregistry("v1");
  const locations: string[] = [];
  let locPageToken: string | undefined = undefined;

  try {
    do {
      const locRes: any = await withProjectRetry("artifactregistry", projectId, () =>
        ar.projects.locations.list({
          name: `projects/${projectId}`,
          pageSize: 100,
          pageToken: locPageToken,
        })
      );
      for (const loc of locRes.data?.locations ?? []) {
        if (loc.name) {
          locations.push(loc.name);
        } else if (loc.locationId) {
          locations.push(`projects/${projectId}/locations/${loc.locationId}`);
        }
      }
      locPageToken = locRes.data?.nextPageToken ?? undefined;
    } while (locPageToken);
  } catch (error) {
    logFetchWarning("artifactregistry", projectId, error);
    return { images: [], failed: true };
  }

  if (locations.length === 0) {
    return { images: [], failed: false };
  }

  const repositories: Array<{ name?: string | null; format?: string | null }> = [];
  let firstRepoListError: unknown = null;
  let repoListSuccessCount = 0;

  const BATCH_SIZE = 10;
  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (locationName) => {
        const locRepos: Array<{ name?: string | null; format?: string | null }> = [];
        let pageToken: string | undefined = undefined;
        do {
          const res: any = await withProjectRetry("artifactregistry", projectId, () =>
            ar.projects.locations.repositories.list({
              parent: locationName,
              pageSize: 1000,
              pageToken,
            })
          );
          locRepos.push(...(res.data?.repositories ?? []));
          pageToken = res.data?.nextPageToken ?? undefined;
        } while (pageToken);
        return locRepos;
      })
    );

    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        repoListSuccessCount += 1;
        repositories.push(...res.value);
      } else if (!firstRepoListError) {
        firstRepoListError = res.reason;
      }
    }
  }

  if (repoListSuccessCount === 0 && firstRepoListError) {
    logFetchWarning("artifactregistry", projectId, firstRepoListError);
    return { images: [], failed: true };
  }

  const dockerRepos = repositories.filter(
    (repo) => repo.name && (!repo.format || repo.format.toUpperCase() === "DOCKER")
  );

  if (dockerRepos.length === 0) {
    return { images: [], failed: false };
  }

  const images: ArDockerImage[] = [];
  let repoWarningLogged = false;

  const repoResults = await Promise.allSettled(
    dockerRepos.map(async (repo) => {
      const repoImages: ArDockerImage[] = [];
      let imgPageToken: string | undefined = undefined;
      let pages = 0;

      do {
        const res: any = await withProjectRetry("artifactregistry", projectId, () =>
          ar.projects.locations.repositories.dockerImages.list({
            parent: repo.name!,
            pageSize: 100,
            pageToken: imgPageToken,
          })
        );

        for (const img of res.data?.dockerImages ?? []) {
          const uri: string | undefined = img.uri ?? img.name ?? undefined;
          if (!uri) continue;
          const normUri = normalizeImageUri(uri);
          const updatedAt =
            img.updateTime ??
            img.uploadTime ??
            img.buildTime ??
            undefined;
          repoImages.push({
            normUri,
            uri: normUri,
            imageName: buildImageName(normUri, img.tags),
            scannedAt: updatedAt ?? new Date().toISOString(),
            ...(updatedAt ? { imageUpdatedAt: updatedAt } : {}),
          });
        }

        imgPageToken = res.data?.nextPageToken ?? undefined;
        pages += 1;
      } while (imgPageToken && pages < 5);

      return repoImages;
    })
  );

  for (const res of repoResults) {
    if (res.status === "fulfilled") {
      images.push(...res.value);
    } else if (!repoWarningLogged) {
      logFetchWarning("artifactregistry", projectId, res.reason);
      repoWarningLogged = true;
    }
  }

  return { images, failed: false };
}

async function listContainerAnalysisOccurrences(projectId: string): Promise<{
  vulnerabilities: any[];
  discoveryByUri: Map<string, DiscoveryState>;
  failed: boolean;
}> {
  if (typeof google.containeranalysis !== "function") {
    return { vulnerabilities: [], discoveryByUri: new Map(), failed: false };
  }

  const ca = google.containeranalysis("v1");
  const vulnerabilities: any[] = [];
  const discoveryByUri = new Map<string, DiscoveryState>();
  let pageToken: string | undefined = undefined;

  try {
    do {
      const res: any = await withProjectRetry("containeranalysis", projectId, () =>
        ca.projects.occurrences.list({
          parent: `projects/${projectId}`,
          filter: 'kind="VULNERABILITY"',
          pageSize: 1000,
          pageToken,
        })
      );

      vulnerabilities.push(...(res.data?.occurrences ?? []));
      pageToken = res.data?.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (error) {
    logFetchWarning("containeranalysis", projectId, error);
    return { vulnerabilities: [], discoveryByUri, failed: true };
  }

  // Fetch DISCOVERY occurrences as best-effort to distinguish clean (0 CVEs) vs unscanned images
  try {
    let discPageToken: string | undefined = undefined;
    let pages = 0;
    do {
      const discRes: any = await ca.projects.occurrences.list({
        parent: `projects/${projectId}`,
        filter: 'kind="DISCOVERY"',
        pageSize: 1000,
        pageToken: discPageToken,
      });

      for (const occ of discRes.data?.occurrences ?? []) {
        if (!occ.resourceUri || !occ.discovery) continue;
        const normUri = normalizeImageUri(occ.resourceUri);
        discoveryByUri.set(normUri, {
          analysisStatus: occ.discovery.analysisStatus,
          lastScanTime: occ.discovery.lastScanTime ?? occ.updateTime ?? occ.createTime,
          errorMessage: occ.discovery.analysisStatusError?.message ?? null,
        });
      }

      discPageToken = discRes.data?.nextPageToken ?? undefined;
      pages += 1;
    } while (discPageToken && pages < 5);
  } catch {
    // Non-fatal: vulnerability occurrences and Artifact Registry images still work without DISCOVERY
  }

  return { vulnerabilities, discoveryByUri, failed: false };
}

function resolveArScanState(
  discovery: DiscoveryState | undefined,
  caFailed: boolean,
  defaultScannedAt: string,
  skipContainerAnalysis = false
): { scanStatus: GcpImageScanStatus; scanStatusMessage?: string; scannedAt: string } {
  if (skipContainerAnalysis) {
    return {
      scanStatus: "unscanned",
      scanStatusMessage: "Not yet scanned. Run a Trivy scan to check for vulnerabilities.",
      scannedAt: defaultScannedAt,
    };
  }
  const status = discovery?.analysisStatus?.toUpperCase();
  if (status === "FINISHED_SUCCESS") {
    return {
      scanStatus: "clean",
      scannedAt: discovery?.lastScanTime || defaultScannedAt,
    };
  }
  if (status === "FINISHED_FAILED") {
    return {
      scanStatus: "failed",
      scanStatusMessage: discovery?.errorMessage || "Vulnerability scan failed in GCP Container Analysis.",
      scannedAt: discovery?.lastScanTime || defaultScannedAt,
    };
  }
  if (status === "PENDING" || status === "SCANNING") {
    return {
      scanStatus: "unscanned",
      scanStatusMessage: "Vulnerability scan is pending or in progress in GCP Container Analysis.",
      scannedAt: discovery?.lastScanTime || defaultScannedAt,
    };
  }
  if (status === "FINISHED_UNSUPPORTED") {
    return {
      scanStatus: "unscanned",
      scanStatusMessage: "Image OS or format is not supported by GCP Container Scanning.",
      scannedAt: discovery?.lastScanTime || defaultScannedAt,
    };
  }
  return {
    scanStatus: "unscanned",
    scanStatusMessage: caFailed
      ? "Container Analysis could not be queried (see GCP warnings above)."
      : "No vulnerability scan results in Container Analysis. Enable containerscanning.googleapis.com or push a new image to trigger scanning.",
    scannedAt: defaultScannedAt,
  };
}

export async function getGcpContainerVulnerabilities(
  projectId: string,
  options?: { skipContainerAnalysis?: boolean }
): Promise<ImageScanResult[]> {
  const skipContainerAnalysis = Boolean(options?.skipContainerAnalysis);

  try {
    initGoogleAuth();
  } catch (error) {
    logFetchWarning(skipContainerAnalysis ? "artifactregistry" : "containeranalysis", projectId, error);
    return [];
  }

  const [arResult, caResult] = await Promise.all([
    listArtifactRegistryDockerImages(projectId),
    skipContainerAnalysis
      ? Promise.resolve({ vulnerabilities: [] as any[], discoveryByUri: new Map<string, DiscoveryState>(), failed: false })
      : listContainerAnalysisOccurrences(projectId),
  ]);

  const resultsByImage = new Map<string, ImageScanResult>();

  // 1. Seed with every Docker image found in Artifact Registry so clean/unscanned images are visible
  for (const img of arResult.images) {
    if (resultsByImage.has(img.normUri)) continue;
    const discovery = caResult.discoveryByUri.get(img.normUri);
    const { scanStatus, scanStatusMessage, scannedAt } = resolveArScanState(
      discovery,
      caResult.failed,
      img.scannedAt,
      skipContainerAnalysis
    );

    resultsByImage.set(img.normUri, {
      imageRef: img.uri,
      imageName: img.imageName,
      cloud: "gcp",
      accountId: projectId,
      scannedAt,
      ...(img.imageUpdatedAt ? { imageUpdatedAt: img.imageUpdatedAt } : {}),
      vulnerabilities: [],
      summary: emptySummary(),
      scanStatus,
      ...(scanStatusMessage ? { scanStatusMessage } : {}),
    });
  }

  // 2. Merge Container Analysis VULNERABILITY occurrences
  for (const occ of caResult.vulnerabilities) {
    if (!occ.resourceUri || !occ.vulnerability) continue;

    const normUri = normalizeImageUri(occ.resourceUri);
    let result = resultsByImage.get(normUri);

    if (!result) {
      result = {
        imageRef: occ.resourceUri,
        imageName: buildImageName(occ.resourceUri),
        cloud: "gcp",
        accountId: projectId,
        scannedAt: occ.createTime ?? new Date().toISOString(),
        vulnerabilities: [],
        summary: emptySummary(),
        scanStatus: "scanned",
      };
      resultsByImage.set(normUri, result);
    } else {
      result.scanStatus = "scanned";
      delete result.scanStatusMessage;
    }

    const vuln = occ.vulnerability;
    const pkg = vuln.packageIssue?.[0];
    const severity = mapSeverity(
      vuln.effectiveSeverity ?? pkg?.effectiveSeverity ?? vuln.severity ?? "NEGLIGIBLE"
    );
    const noteId = occ.noteName?.split("/").pop();
    const cveId = vuln.shortDescription || noteId || "Unknown CVE";
    const cvssScore = vuln.cvssScore ?? vuln.cvssv3?.baseScore ?? undefined;
    const description = (vuln.longDescription || occ.noteName || "").split("\n")[0];

    const packageName = pkg?.affectedPackage ?? "Unknown package";
    const installedVersion = pkg?.affectedVersion?.name ?? "Unknown version";
    const fixedVersion =
      pkg?.fixedVersion?.kind === "MAXIMUM"
        ? undefined
        : (pkg?.fixedVersion?.name ?? undefined);

    result.vulnerabilities.push({
      cveId,
      severity,
      packageName,
      installedVersion,
      fixedVersion,
      description,
      cvssScore,
    });

    result.summary[severity]++;
  }

  return Array.from(resultsByImage.values());
}
