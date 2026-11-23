/** @jest-environment node */

const mockAuth = jest.fn();
const mockGetUserCloudCredentials = jest.fn();
const mockGetGcpContainerVulnerabilities = jest.fn();
const mockGetAwsContainerVulnerabilities = jest.fn();
const mockGetGhcrVulnerabilities = jest.fn();
const mockGetDockerHubVulnerabilities = jest.fn();
const mockSql = jest.fn(async () => ({ rows: [] as any[] }));
const mockEnsureGcpSnapshotTable = jest.fn(async () => {});
const mockEnsureContainerScanCacheTable = jest.fn(async () => {});
const mockDiscoverUserProjectIds = jest.fn();
const mockIsTrivyAvailable = jest.fn();
const mockScanImageWithTrivy = jest.fn();

jest.mock("@/lib/auth", () => ({
  auth: (...args: any[]) => mockAuth(...args),
}));

jest.mock("@/lib/credentials", () => ({
  getUserCloudCredentials: (...args: any[]) => mockGetUserCloudCredentials(...args),
}));

jest.mock("@/lib/gcp/container-analysis", () => {
  const actual = jest.requireActual("@/lib/gcp/container-analysis");
  return {
    ...actual,
    getGcpContainerVulnerabilities: (...args: any[]) => mockGetGcpContainerVulnerabilities(...args),
  };
});

jest.mock("@/lib/aws/ecr-scanning", () => ({
  getAwsContainerVulnerabilities: (...args: any[]) => mockGetAwsContainerVulnerabilities(...args),
}));

jest.mock("@/lib/github/ghcr-scanning", () => ({
  getGhcrVulnerabilities: (...args: any[]) => mockGetGhcrVulnerabilities(...args),
}));

jest.mock("@/lib/dockerhub/dockerhub-scanning", () => ({
  getDockerHubVulnerabilities: (...args: any[]) => mockGetDockerHubVulnerabilities(...args),
}));

jest.mock("@/lib/db", () => ({
  sql: (...args: any[]) => (mockSql as any)(...args),
  ensureGcpSnapshotTable: () => mockEnsureGcpSnapshotTable(),
  ensureContainerScanCacheTable: () => mockEnsureContainerScanCacheTable(),
}));

jest.mock("@/lib/trivy/scanner", () => ({
  isTrivyAvailable: (...args: any[]) => mockIsTrivyAvailable(...args),
  scanImageWithTrivy: (...args: any[]) => mockScanImageWithTrivy(...args),
}));

jest.mock("@/lib/gcp/client", () => {
  const actual = jest.requireActual("@/lib/gcp/client");
  return {
    ...actual,
    discoverUserProjectIds: (...args: any[]) => mockDiscoverUserProjectIds(...args),
    getGcpAccessToken: jest.fn(async () => "mock-gcp-token"),
  };
});

import { NextRequest } from "next/server";
import { GET } from "@/app/api/container-scan/route";
import { POST as POST_SCAN } from "@/app/api/container-scan/scan/route";
import { logFetchWarning, resetGcpScanWarnings } from "@/lib/gcp/client";

describe("GET /api/container-scan", () => {
  const origEnv = {
    USE_MOCK_DATA: process.env.USE_MOCK_DATA,
    USE_MOCK_AWS_DATA: process.env.USE_MOCK_AWS_DATA,
    DEMO_MODE: process.env.DEMO_MODE,
    GCP_USE_ADC: process.env.GCP_USE_ADC,
    GCP_PROJECTS: process.env.GCP_PROJECTS,
    GCP_ORG_ID: process.env.GCP_ORG_ID,
    GCP_SERVICE_ACCOUNT_KEY: process.env.GCP_SERVICE_ACCOUNT_KEY,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetGcpScanWarnings();
    delete process.env.USE_MOCK_DATA;
    delete process.env.USE_MOCK_AWS_DATA;
    delete process.env.DEMO_MODE;
    delete process.env.GCP_USE_ADC;
    delete process.env.GCP_PROJECTS;
    delete process.env.GCP_ORG_ID;
    delete process.env.GCP_SERVICE_ACCOUNT_KEY;
    delete process.env.POSTGRES_URL;

    mockGetUserCloudCredentials.mockResolvedValue(null);
    mockGetGcpContainerVulnerabilities.mockResolvedValue([]);
    mockGetAwsContainerVulnerabilities.mockResolvedValue([]);
    mockGetGhcrVulnerabilities.mockResolvedValue([]);
    mockGetDockerHubVulnerabilities.mockResolvedValue([]);
    mockDiscoverUserProjectIds.mockResolvedValue([]);
    mockIsTrivyAvailable.mockResolvedValue(false);
    mockSql.mockResolvedValue({ rows: [] });
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.entries(origEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("uses per-user GCP service account credentials and falls back to SA project_id when GCP_PROJECTS is unset", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });
    mockGetUserCloudCredentials.mockResolvedValue({
      serviceAccountKey: JSON.stringify({
        type: "service_account",
        project_id: "theinsite-prod",
        client_email: "watchmen@theinsite-prod.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n",
      }),
    });
    mockGetGcpContainerVulnerabilities.mockResolvedValue([
      {
        imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/app@sha256:123",
        imageName: "app:v1.0.0",
        cloud: "gcp",
        accountId: "theinsite-prod",
        scannedAt: "2026-11-23T08:00:00Z",
        vulnerabilities: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
        scanStatus: "unscanned",
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetUserCloudCredentials).toHaveBeenCalledWith("pavel@theinsite.dev", "gcp");
    expect(mockGetGcpContainerVulnerabilities).toHaveBeenCalledWith("theinsite-prod");
    expect(body.gcpProjects).toEqual(["theinsite-prod"]);
    expect(body.gcpAuthConfigured).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].imageName).toBe("app:v1.0.0");
  });

  it("merges cached Trivy scans onto unscanned Artifact Registry images and exposes trivyAvailable", async () => {
    process.env.GCP_USE_ADC = "true";
    process.env.GCP_PROJECTS = "theinsite-dev";
    process.env.POSTGRES_URL = "postgresql://localhost/watchmen";
    mockIsTrivyAvailable.mockResolvedValue(true);

    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });
    mockGetGcpContainerVulnerabilities.mockResolvedValue([
      {
        imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:aaa",
        imageName: "web:dev",
        cloud: "gcp",
        accountId: "theinsite-dev",
        scannedAt: "2026-11-23T08:00:00Z",
        vulnerabilities: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
        scanStatus: "unscanned",
      },
    ]);
    mockSql.mockResolvedValueOnce({
      rows: [
        {
          image_ref: "europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:aaa",
          cloud: "gcp",
          account_id: "theinsite-dev",
          scanner: "trivy",
          vulnerabilities: [
            {
              cveId: "CVE-2025-1234",
              severity: "critical",
              packageName: "openssl",
              installedVersion: "3.0.0",
              fixedVersion: "3.0.1",
              description: "Critical issue",
            },
          ],
          summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
          scanned_at: "2026-11-23T12:00:00Z",
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.trivyAvailable).toBe(true);
    expect(mockGetGcpContainerVulnerabilities).toHaveBeenCalledWith("theinsite-dev", {
      skipContainerAnalysis: true,
    });
    expect(body.results[0]).toMatchObject({
      imageName: "web:dev",
      scanStatus: "scanned",
      scanner: "trivy",
      summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
    });
  });

  it("suppresses optional containeranalysis permission warnings when Trivy is available", async () => {
    process.env.GCP_USE_ADC = "true";
    process.env.GCP_PROJECTS = "theinsite-dev";
    mockIsTrivyAvailable.mockResolvedValue(true);
    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });
    mockGetGcpContainerVulnerabilities.mockImplementation(async (pid: string) => {
      logFetchWarning("containeranalysis", pid, { code: 403, message: "Permission denied" });
      return [];
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.trivyAvailable).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  it("falls back to projects from user_snapshots when GCP_USE_ADC=true and GCP_PROJECTS/GCP_ORG_ID are unset", async () => {
    process.env.GCP_USE_ADC = "true";
    process.env.POSTGRES_URL = "postgresql://localhost/watchmen";

    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });
    mockSql.mockResolvedValue({
      rows: [
        {
          snapshot: {
            projects: [{ projectId: "theinsite-dev" }, { projectId: "theinsite-prod" }],
          },
        },
      ],
    });
    mockGetGcpContainerVulnerabilities.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetGcpContainerVulnerabilities).toHaveBeenCalledWith("theinsite-dev");
    expect(mockGetGcpContainerVulnerabilities).toHaveBeenCalledWith("theinsite-prod");
    expect(body.gcpProjects).toEqual(["theinsite-dev", "theinsite-prod"]);
  });

  it("returns GCP scan warnings in the response payload when Artifact Registry or Container Analysis is blocked", async () => {
    process.env.GCP_USE_ADC = "true";
    process.env.GCP_PROJECTS = "theinsite-prod";

    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });
    mockGetGcpContainerVulnerabilities.mockImplementation(async (pid: string) => {
      logFetchWarning("artifactregistry", pid, { code: 403, message: "Permission denied" });
      return [];
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.results).toEqual([]);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({
      service: "artifactregistry",
      projectId: "theinsite-prod",
      code: "permission_denied",
      requiredRoles: ["roles/artifactregistry.reader"],
    });
  });

  it("returns GCP mock scan results when USE_MOCK_DATA=true even if USE_MOCK_AWS_DATA is false", async () => {
    process.env.USE_MOCK_DATA = "true";
    mockAuth.mockResolvedValue({
      user: { email: "pavel@theinsite.dev" },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetGcpContainerVulnerabilities).not.toHaveBeenCalled();
    expect(body.results.some((r: any) => r.cloud === "gcp")).toBe(true);
  });

  describe("POST /api/container-scan/scan", () => {
    it("scans authorized Artifact Registry images with Trivy and persists to cache", async () => {
      process.env.GCP_USE_ADC = "true";
      process.env.GCP_PROJECTS = "theinsite-dev";
      process.env.POSTGRES_URL = "postgresql://localhost/watchmen";
      mockIsTrivyAvailable.mockResolvedValue(true);
      mockAuth.mockResolvedValue({
        user: { email: "pavel@theinsite.dev" },
      });
      mockGetGcpContainerVulnerabilities.mockResolvedValue([
        {
          imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/api@sha256:111",
          imageName: "api:dev",
          cloud: "gcp",
          accountId: "theinsite-dev",
          scannedAt: "2026-11-23T08:00:00Z",
          vulnerabilities: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
          scanStatus: "unscanned",
        },
      ]);
      mockScanImageWithTrivy.mockResolvedValue({
        vulnerabilities: [
          {
            cveId: "CVE-2026-0042",
            severity: "high",
            packageName: "zlib",
            installedVersion: "1.2.13",
            fixedVersion: "1.3.1",
            description: "Zlib issue",
          },
        ],
        summary: { critical: 0, high: 1, medium: 0, low: 0, negligible: 0 },
        scannedAt: "2026-11-23T16:00:00Z",
      });

      const req = new NextRequest("http://localhost:3000/api/container-scan/scan", {
        method: "POST",
        body: JSON.stringify({
          imageRefs: ["europe-west3-docker.pkg.dev/theinsite-dev/cms/api@sha256:111"],
        }),
      });

      const res = await POST_SCAN(req);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(mockScanImageWithTrivy).toHaveBeenCalledWith({
        imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/api@sha256:111",
        accessToken: "mock-gcp-token",
      });
      expect(mockSql).toHaveBeenCalled();
      expect(body.scanned).toHaveLength(1);
      expect(body.scanned[0]).toMatchObject({
        scanner: "trivy",
        scanStatus: "scanned",
        summary: { critical: 0, high: 1, medium: 0, low: 0, negligible: 0 },
      });
    });

    it("rejects arbitrary imageRefs not present in authorized GCP projects with 404", async () => {
      process.env.GCP_USE_ADC = "true";
      process.env.GCP_PROJECTS = "theinsite-dev";
      mockIsTrivyAvailable.mockResolvedValue(true);
      mockAuth.mockResolvedValue({
        user: { email: "pavel@theinsite-dev" },
      });
      mockGetGcpContainerVulnerabilities.mockResolvedValue([]);

      const req = new NextRequest("http://localhost:3000/api/container-scan/scan", {
        method: "POST",
        body: JSON.stringify({
          imageRefs: ["evil.registry.example.com/attacker/image:latest"],
        }),
      });

      const res = await POST_SCAN(req);
      expect(res.status).toBe(404);
      expect(mockScanImageWithTrivy).not.toHaveBeenCalled();
    });
  });
});
