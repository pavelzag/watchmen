/** @jest-environment node */

const mockLocationsList = jest.fn();
const mockRepositoriesList = jest.fn();
const mockDockerImagesList = jest.fn();
const mockOccurrencesList = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({})),
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    options: jest.fn(),
    artifactregistry: jest.fn(() => ({
      projects: {
        locations: {
          list: mockLocationsList,
          repositories: {
            list: mockRepositoriesList,
            dockerImages: {
              list: mockDockerImagesList,
            },
          },
        },
      },
    })),
    containeranalysis: jest.fn(() => ({
      projects: {
        occurrences: {
          list: mockOccurrencesList,
        },
      },
    })),
  },
}));

import { getGcpContainerVulnerabilities } from "@/lib/gcp/container-analysis";
import {
  getGcpScanWarnings,
  initGoogleAuthFromAdc,
  resetGcpScanWarnings,
} from "@/lib/gcp/client";

describe("GCP Artifact Registry & Container Analysis scanning", () => {
  const originalUseAdc = process.env.GCP_USE_ADC;
  const originalSaKey = process.env.GCP_SERVICE_ACCOUNT_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    resetGcpScanWarnings();
    process.env.GCP_USE_ADC = "true";
    delete process.env.GCP_SERVICE_ACCOUNT_KEY;
    initGoogleAuthFromAdc();
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalUseAdc === undefined) delete process.env.GCP_USE_ADC;
    else process.env.GCP_USE_ADC = originalUseAdc;
    if (originalSaKey === undefined) delete process.env.GCP_SERVICE_ACCOUNT_KEY;
    else process.env.GCP_SERVICE_ACCOUNT_KEY = originalSaKey;
  });

  it("enumerates Artifact Registry locations first (never locations/-) and discovers Docker images even with zero CVEs", async () => {
    mockLocationsList.mockResolvedValue({
      data: {
        locations: [
          { name: "projects/theinsite-prod/locations/europe-west3", locationId: "europe-west3" },
          { name: "projects/theinsite-prod/locations/us-central1", locationId: "us-central1" },
        ],
      },
    });

    mockRepositoriesList.mockImplementation(async ({ parent }: { parent: string }) => {
      expect(parent).not.toContain("locations/-");
      if (parent.endsWith("/europe-west3")) {
        return {
          data: {
            repositories: [
              {
                name: "projects/theinsite-prod/locations/europe-west3/repositories/cms",
                format: "DOCKER",
              },
              {
                name: "projects/theinsite-prod/locations/europe-west3/repositories/npm-libs",
                format: "NPM",
              },
            ],
          },
        };
      }
      return { data: { repositories: [] } };
    });

    mockDockerImagesList.mockResolvedValue({
      data: {
        dockerImages: [
          {
            name: "projects/theinsite-prod/locations/europe-west3/repositories/cms/dockerImages/cms-web@sha256:aaa",
            uri: "europe-west3-docker.pkg.dev/theinsite-prod/cms/cms-web@sha256:aaa",
            tags: ["latest", "v1.4.0"],
            updateTime: "2026-11-20T12:00:00Z",
          },
          {
            name: "projects/theinsite-prod/locations/europe-west3/repositories/cms/dockerImages/cms-worker@sha256:bbb",
            uri: "europe-west3-docker.pkg.dev/theinsite-prod/cms/cms-worker@sha256:bbb",
            tags: ["v2.0.0"],
            uploadTime: "2026-11-21T12:00:00Z",
          },
        ],
      },
    });

    mockOccurrencesList
      .mockResolvedValueOnce({ data: { occurrences: [] } }) // VULNERABILITY
      .mockResolvedValueOnce({
        data: {
          occurrences: [
            {
              resourceUri: "https://europe-west3-docker.pkg.dev/theinsite-prod/cms/cms-web@sha256:aaa",
              discovery: {
                analysisStatus: "FINISHED_SUCCESS",
                lastScanTime: "2026-11-20T12:05:00Z",
              },
            },
          ],
        },
      }); // DISCOVERY

    const results = await getGcpContainerVulnerabilities("theinsite-prod");

    expect(mockLocationsList).toHaveBeenCalledWith(
      expect.objectContaining({ name: "projects/theinsite-prod" })
    );
    expect(mockRepositoriesList).toHaveBeenCalledTimes(2);
    expect(mockDockerImagesList).toHaveBeenCalledTimes(1);
    expect(mockDockerImagesList).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: "projects/theinsite-prod/locations/europe-west3/repositories/cms",
      })
    );
    expect(results).toHaveLength(2);

    const web = results.find((r) => r.imageName === "cms-web:v1.4.0");
    expect(web).toMatchObject({
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/cms-web@sha256:aaa",
      imageName: "cms-web:v1.4.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      scanStatus: "clean",
      scannedAt: "2026-11-20T12:05:00Z",
      vulnerabilities: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
    });

    const worker = results.find((r) => r.imageName === "cms-worker:v2.0.0");
    expect(worker).toMatchObject({
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/cms-worker@sha256:bbb",
      scanStatus: "unscanned",
      vulnerabilities: [],
    });
    expect(worker?.scanStatusMessage).toContain("containerscanning.googleapis.com");
  });

  it("merges Artifact Registry images with Container Analysis vulnerabilities by normalizing https:// URIs", async () => {
    mockLocationsList.mockResolvedValue({
      data: {
        locations: [{ name: "projects/theinsite-prod/locations/us-central1" }],
      },
    });
    mockRepositoriesList.mockResolvedValue({
      data: {
        repositories: [
          {
            name: "projects/theinsite-prod/locations/us-central1/repositories/services",
            format: "DOCKER",
          },
        ],
      },
    });

    mockDockerImagesList.mockResolvedValue({
      data: {
        dockerImages: [
          {
            uri: "us-central1-docker.pkg.dev/theinsite-prod/services/api@sha256:1234",
            tags: ["prod-2.1.0"],
            updateTime: "2026-11-22T09:00:00Z",
          },
        ],
      },
    });

    mockOccurrencesList
      .mockResolvedValueOnce({
        data: {
          occurrences: [
            {
              resourceUri: "https://us-central1-docker.pkg.dev/theinsite-prod/services/api@sha256:1234",
              noteName: "projects/goog-vulnz/notes/CVE-2025-9999",
              createTime: "2026-11-22T09:05:00Z",
              vulnerability: {
                severity: "MEDIUM",
                effectiveSeverity: "CRITICAL",
                cvssv3: { baseScore: 9.8 },
                longDescription: "Remote code execution in libfoo\nMore details",
                packageIssue: [
                  {
                    affectedPackage: "libfoo",
                    affectedVersion: { name: "1.0.0" },
                    fixedVersion: { name: "1.0.2", kind: "NORMAL" },
                  },
                ],
              },
            },
            {
              resourceUri: "https://us-central1-docker.pkg.dev/theinsite-prod/services/api@sha256:1234",
              noteName: "projects/goog-vulnz/notes/CVE-2025-1111",
              vulnerability: {
                shortDescription: "CVE-2025-1111",
                severity: "HIGH",
                cvssScore: 7.5,
                longDescription: "Unpatched kernel issue",
                packageIssue: [
                  {
                    affectedPackage: "linux-libc-dev",
                    affectedVersion: { name: "6.1.0" },
                    fixedVersion: { kind: "MAXIMUM", name: "" },
                  },
                ],
              },
            },
          ],
          nextPageToken: undefined,
        },
      })
      .mockResolvedValueOnce({ data: { occurrences: [] } });

    const results = await getGcpContainerVulnerabilities("theinsite-prod");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      imageRef: "us-central1-docker.pkg.dev/theinsite-prod/services/api@sha256:1234",
      imageName: "api:prod-2.1.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      scanStatus: "scanned",
      summary: { critical: 1, high: 1, medium: 0, low: 0, negligible: 0 },
    });
    expect(results[0].vulnerabilities).toEqual([
      {
        cveId: "CVE-2025-9999",
        severity: "critical",
        packageName: "libfoo",
        installedVersion: "1.0.0",
        fixedVersion: "1.0.2",
        description: "Remote code execution in libfoo",
        cvssScore: 9.8,
      },
      {
        cveId: "CVE-2025-1111",
        severity: "high",
        packageName: "linux-libc-dev",
        installedVersion: "6.1.0",
        fixedVersion: undefined,
        description: "Unpatched kernel issue",
        cvssScore: 7.5,
      },
    ]);
  });

  it("still returns Artifact Registry images and records a warning when Container Analysis API is disabled or denied", async () => {
    mockLocationsList.mockResolvedValue({
      data: {
        locations: [{ name: "projects/theinsite-dev/locations/europe-west3" }],
      },
    });
    mockRepositoriesList.mockResolvedValue({
      data: {
        repositories: [
          {
            name: "projects/theinsite-dev/locations/europe-west3/repositories/apps",
            format: "DOCKER",
          },
        ],
      },
    });
    mockDockerImagesList.mockResolvedValue({
      data: {
        dockerImages: [
          {
            uri: "europe-west3-docker.pkg.dev/theinsite-dev/apps/gateway@sha256:deadbeef",
            tags: ["dev"],
            updateTime: "2026-11-22T10:00:00Z",
          },
        ],
      },
    });
    mockOccurrencesList.mockRejectedValue({
      code: 403,
      message: "Container Analysis API has not been used in project theinsite-dev before or it is disabled.",
    });

    const results = await getGcpContainerVulnerabilities("theinsite-dev");
    const warnings = getGcpScanWarnings();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      imageName: "gateway:dev",
      scanStatus: "unscanned",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      service: "containeranalysis",
      projectId: "theinsite-dev",
      code: "api_not_enabled",
      requiredApi: "containeranalysis.googleapis.com",
      enableApiCommand: "gcloud services enable containeranalysis.googleapis.com --project=theinsite-dev",
    });
  });

  it("records a permission warning for Artifact Registry while still returning Container Analysis results", async () => {
    mockLocationsList.mockRejectedValue({
      code: 403,
      message: "Permission 'artifactregistry.locations.list' denied on resource",
    });
    mockOccurrencesList
      .mockResolvedValueOnce({
        data: {
          occurrences: [
            {
              resourceUri: "https://gcr.io/theinsite-prod/legacy-svc@sha256:999",
              vulnerability: {
                shortDescription: "CVE-2024-0001",
                severity: "HIGH",
                packageIssue: [{ affectedPackage: "openssl", affectedVersion: { name: "3.0.0" } }],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { occurrences: [] } });

    const results = await getGcpContainerVulnerabilities("theinsite-prod");
    const warnings = getGcpScanWarnings();

    expect(results).toHaveLength(1);
    expect(results[0].imageRef).toBe("https://gcr.io/theinsite-prod/legacy-svc@sha256:999");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      service: "artifactregistry",
      projectId: "theinsite-prod",
      code: "permission_denied",
      requiredRoles: ["roles/artifactregistry.reader"],
    });
  });
});
