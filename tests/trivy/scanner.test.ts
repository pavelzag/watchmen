/** @jest-environment node */

const mockExecFile = jest.fn();

jest.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import {
  isTrivyAvailable,
  isValidImageRef,
  parseTrivyReport,
  scanImageWithTrivy,
} from "@/lib/trivy/scanner";

describe("Trivy scanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates container image references strictly", () => {
    expect(
      isValidImageRef("europe-west3-docker.pkg.dev/theinsite-prod/cms/app@sha256:abc123")
    ).toBe(true);
    expect(isValidImageRef("--help")).toBe(false);
    expect(isValidImageRef("repo/img; rm -rf /")).toBe(false);
    expect(isValidImageRef("")).toBe(false);
  });

  it("parses and deduplicates Trivy JSON vulnerability reports", () => {
    const report = JSON.stringify({
      Results: [
        {
          Target: "app (alpine 3.20)",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2025-1000",
              PkgName: "openssl",
              InstalledVersion: "3.3.0-r0",
              FixedVersion: "3.3.1-r0",
              Severity: "CRITICAL",
              Title: "OpenSSL buffer overflow\nMore details",
              CVSS: { nvd: { V3Score: 9.8 } },
            },
            {
              VulnerabilityID: "CVE-2025-1000",
              PkgName: "openssl",
              InstalledVersion: "3.3.0-r0",
              FixedVersion: "3.3.1-r0",
              Severity: "CRITICAL",
              Title: "Duplicate entry",
            },
            {
              VulnerabilityID: "CVE-2025-2000",
              PkgName: "curl",
              InstalledVersion: "8.0.0",
              Severity: "HIGH",
              Description: "Curl issue",
              CVSS: { redhat: { V2Score: 7.5 } },
            },
          ],
        },
      ],
    });

    const parsed = parseTrivyReport(report);
    expect(parsed.summary).toEqual({
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      negligible: 0,
    });
    expect(parsed.vulnerabilities).toEqual([
      {
        cveId: "CVE-2025-1000",
        severity: "critical",
        packageName: "openssl",
        installedVersion: "3.3.0-r0",
        fixedVersion: "3.3.1-r0",
        description: "OpenSSL buffer overflow",
        cvssScore: 9.8,
      },
      {
        cveId: "CVE-2025-2000",
        severity: "high",
        packageName: "curl",
        installedVersion: "8.0.0",
        fixedVersion: undefined,
        description: "Curl issue",
        cvssScore: 7.5,
      },
    ]);
  });

  it("checks trivy binary availability cleanly", async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => cb(null, { stdout: "Version: 0.76.2", stderr: "" }));
    expect(await isTrivyAvailable()).toBe(true);

    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => cb(new Error("ENOENT")));
    expect(await isTrivyAvailable()).toBe(false);
  });

  it("passes oauth2accesstoken via env vars and scans imageRef safely", async () => {
    mockExecFile.mockImplementation((bin, args, opts, cb) => {
      expect(bin).toBe("trivy");
      expect(args).toContain("--scanners");
      expect(args).toContain("vuln");
      expect(args[args.length - 1]).toBe("europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:aaa");
      expect(opts.env.TRIVY_USERNAME).toBe("oauth2accesstoken");
      expect(opts.env.TRIVY_PASSWORD).toBe("gcp-access-token");
      cb(null, { stdout: JSON.stringify({ Results: [] }), stderr: "" });
    });

    const out = await scanImageWithTrivy({
      imageRef: "https://europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:aaa",
      accessToken: "gcp-access-token",
    });

    expect(out.vulnerabilities).toEqual([]);
    expect(out.summary).toEqual({ critical: 0, high: 0, medium: 0, low: 0, negligible: 0 });
  });
});
