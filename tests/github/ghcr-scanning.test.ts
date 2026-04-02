/** @jest-environment node */

import { getGhcrVulnerabilities } from "@/lib/github/ghcr-scanning";
import { getUserCloudCredentials } from "@/lib/credentials";

jest.mock("@/lib/credentials");

const mockGetUserCloudCredentials = getUserCloudCredentials as jest.MockedFunction<typeof getUserCloudCredentials>;

describe("GHCR scanning", () => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalOrg = process.env.GITHUB_ORG;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_ORG = "watchmen-org";
    mockGetUserCloudCredentials.mockResolvedValue(null);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  afterAll(() => {
    process.env.GITHUB_TOKEN = originalToken;
    process.env.GITHUB_ORG = originalOrg;
  });

  it("maps GitHub GraphQL vulnerability alerts into scan results", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        data: {
          organization: {
            repositories: {
              nodes: [
                {
                  name: "api",
                  vulnerabilityAlerts: {
                    nodes: [
                      {
                        securityVulnerability: {
                          advisory: {
                            summary: "Critical remote code execution issue",
                            severity: "CRITICAL",
                            cvss: { score: 9.8 },
                            identifiers: [{ type: "CVE", value: "CVE-2026-0001" }],
                          },
                          package: { name: "openssl" },
                          vulnerableVersionRange: "< 3.0.0",
                          firstPatchedVersion: { identifier: "3.0.0" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    } as Response);

    const results = await getGhcrVulnerabilities("dev@example.com");

    expect(mockGetUserCloudCredentials).toHaveBeenCalledWith("dev@example.com", "ghcr");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      imageRef: "ghcr.io/watchmen-org/api:latest",
      imageName: "api:latest",
      cloud: "ghcr",
      accountId: "watchmen-org",
      summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
    });
    expect(results[0].vulnerabilities[0]).toMatchObject({
      cveId: "CVE-2026-0001",
      severity: "critical",
      packageName: "openssl",
      fixedVersion: "3.0.0",
    });
  });

  it("uses the user GHCR token when one is configured", async () => {
    mockGetUserCloudCredentials.mockResolvedValue({ token: "user-ghcr-token" });
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        data: {
          organization: {
            repositories: {
              nodes: [],
            },
          },
        },
      }),
    } as Response);

    await getGhcrVulnerabilities("dev@example.com");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "bearer user-ghcr-token",
        }),
      })
    );
  });

  it("returns an empty result set when GitHub GraphQL responds with errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        errors: [{ message: "Resource not accessible by integration" }],
      }),
    } as Response);

    const results = await getGhcrVulnerabilities();

    expect(results).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("[ghcr] GraphQL error:", [{ message: "Resource not accessible by integration" }]);
  });
});
