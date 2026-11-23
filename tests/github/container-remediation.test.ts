/** @jest-environment node */

const mockSearchTfFiles = jest.fn();
const mockSearchContainerFiles = jest.fn();
const mockGetFileContent = jest.fn();
const mockCallAI = jest.fn();

jest.mock("@/lib/github/client", () => ({
  searchTfFiles: (...args: any[]) => mockSearchTfFiles(...args),
  searchContainerFiles: (...args: any[]) => mockSearchContainerFiles(...args),
  getFileContent: (...args: any[]) => mockGetFileContent(...args),
}));

jest.mock("@/lib/ai/client", () => ({
  callAI: (...args: any[]) => mockCallAI(...args),
}));

import { buildRemediationPlan, clearRemediationCaches } from "@/lib/github/terraform-remediation";
import { remediationTargetFromContainerCve } from "@/lib/github/remediation-targets";
import { handoffIssueFromContainerCve, issueToRemediationTarget } from "@/lib/handoff/tasks";

describe("Container CVE remediation targets & GitHub PR planning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRemediationCaches();
  });

  it("creates RemediationTarget and HandoffIssueItem from a container CVE", () => {
    const cve = {
      cveId: "CVE-2026-1234",
      severity: "critical" as const,
      packageName: "openssl",
      installedVersion: "3.0.0",
      fixedVersion: "3.0.2",
      description: "Critical OpenSSL overflow",
    };

    const target = remediationTargetFromContainerCve({
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/api@sha256:abc",
      imageName: "api:v1.2.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      cve,
    });
    expect(target.kind).toBe("container_cve");
    expect(target.autoRemediable).toBe(true);
    expect(target.searchTerms).toContain("openssl");

    const handoff = handoffIssueFromContainerCve({
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/api@sha256:abc",
      imageName: "api:v1.2.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      cve,
      aiRecommendation: "Upgrade base image",
    });
    expect(handoff.kind).toBe("container_cve");
    expect(handoff.proposedPlan).toBe("Upgrade base image");

    const roundTrip = issueToRemediationTarget(handoff);
    expect(roundTrip.kind).toBe("container_cve");
    expect(roundTrip.resourceName).toBe("api:v1.2.0");
  });

  it("searches container/dependency files and generates Dockerfile/manifest patches without Terraform sanitization", async () => {
    mockSearchContainerFiles.mockResolvedValue(["Dockerfile", "package.json"]);
    mockGetFileContent.mockImplementation(async (_t, _o, _r, path: string) => {
      if (path === "Dockerfile") {
        return {
          content: "FROM node:22.0-alpine\nWORKDIR /app\nCOPY . .\n",
          sha: "sha-dockerfile",
        };
      }
      return {
        content: '{"name":"api","dependencies":{"express":"4.18.0"}}\n',
        sha: "sha-pkg",
      };
    });
    mockCallAI.mockResolvedValueOnce("```dockerfile\nFROM node:22.11-alpine\nWORKDIR /app\nCOPY . .\n```");

    const target = remediationTargetFromContainerCve({
      imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/api@sha256:abc",
      imageName: "api:v1.2.0",
      cloud: "gcp",
      accountId: "theinsite-prod",
      cve: {
        cveId: "CVE-2026-1234",
        severity: "critical",
        packageName: "openssl",
        installedVersion: "3.0.0",
        fixedVersion: "3.0.2",
        description: "OpenSSL flaw in alpine base image",
      },
    });

    const plan = await buildRemediationPlan(
      "gh-token",
      "pavelzag",
      "api-repo",
      [target],
      "google",
      "ai-key"
    );

    expect(mockSearchTfFiles).not.toHaveBeenCalled();
    expect(mockSearchContainerFiles).toHaveBeenCalledWith("gh-token", "pavelzag", "api-repo");
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({
      path: "Dockerfile",
      fixedContent: "FROM node:22.11-alpine\nWORKDIR /app\nCOPY . .",
      sha: "sha-dockerfile",
    });
    expect(plan.fullyAddressed).toBe(true);
  });
});
