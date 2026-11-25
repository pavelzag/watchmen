import { deduplicateImagesAcrossEnvironments, type ImageScanResult } from "@/lib/container-scanning";

describe("lib/container-scanning deduplication", () => {
  it("deduplicates images across prod and dev with identical digest or identical CVE signature while preserving differences", () => {
    const prodSameDigest: ImageScanResult = {
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/web@sha256:aaaa1111",
      imageName: "web:v1.2.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      scannedAt: "2026-11-26T10:00:00Z",
      scanStatus: "scanned",
      vulnerabilities: [
        {
          cveId: "CVE-2026-1001",
          severity: "critical",
          packageName: "openssl",
          installedVersion: "3.0.0",
          fixedVersion: "3.0.2",
          description: "Critical OpenSSL issue",
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
    };

    const devSameDigest: ImageScanResult = {
      ...prodSameDigest,
      imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:aaaa1111",
      imageName: "web:dev-latest",
      accountId: "theinsite-dev",
      scannedAt: "2026-11-26T11:00:00Z",
    };

    const prodWorker: ImageScanResult = {
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/worker@sha256:bbbb2222",
      imageName: "worker:v2.0.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      scannedAt: "2026-11-26T10:00:00Z",
      scanStatus: "scanned",
      vulnerabilities: [
        {
          cveId: "CVE-2026-2002",
          severity: "high",
          packageName: "zlib",
          installedVersion: "1.2.0",
          description: "High zlib issue",
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0, negligible: 0 },
    };

    const devWorkerDifferentVuln: ImageScanResult = {
      ...prodWorker,
      imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/worker@sha256:cccc3333",
      imageName: "worker:dev",
      accountId: "theinsite-dev",
      vulnerabilities: [
        {
          cveId: "CVE-2026-9999",
          severity: "medium",
          packageName: "curl",
          installedVersion: "8.0.0",
          description: "Dev-only issue",
        },
      ],
      summary: { critical: 0, high: 0, medium: 1, low: 0, negligible: 0 },
    };

    const deduped = deduplicateImagesAcrossEnvironments([
      devSameDigest,
      prodSameDigest,
      prodWorker,
      devWorkerDifferentVuln,
    ]);

    expect(deduped).toHaveLength(3);
    const webEntry = deduped.find((r) => r.imageName.startsWith("web:"));
    expect(webEntry?.accountId).toBe("theinsite-prod");
    expect(webEntry?.duplicates).toHaveLength(2);
    expect(webEntry?.duplicates?.map((d) => d.accountId)).toEqual(["theinsite-prod", "theinsite-dev"]);

    expect(deduped.filter((r) => r.imageName.startsWith("worker:"))).toHaveLength(2);
  });

  it("deduplicates rebuilt prod and dev images without matching digests when app name and CVEs are identical", () => {
    const devImg: ImageScanResult = {
      imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/api:dev",
      imageName: "api:dev",
      cloud: "gcp",
      accountId: "theinsite-dev",
      scannedAt: "2026-11-26T10:00:00Z",
      scanStatus: "scanned",
      vulnerabilities: [
        {
          cveId: "CVE-2026-1111",
          severity: "high",
          packageName: "openssl",
          installedVersion: "3.0.0",
          description: "Issue",
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0, negligible: 0 },
    };

    const prodImg: ImageScanResult = {
      ...devImg,
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/api:1.0.0",
      imageName: "api:1.0.0",
      accountId: "theinsite-prod",
    };

    const deduped = deduplicateImagesAcrossEnvironments([devImg, prodImg]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].accountId).toBe("theinsite-prod");
    expect(deduped[0].duplicates).toHaveLength(2);
  });
});
