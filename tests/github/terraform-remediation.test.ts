/** @jest-environment node */

import {
  buildRemediationPlan,
  clearRemediationCaches,
} from "@/lib/github/terraform-remediation";
import {
  remediationTargetFromAttackPath,
  remediationTargetFromFinding,
} from "@/lib/github/remediation-targets";
import { searchTfFiles, getFileContent } from "@/lib/github/client";
import { callAI } from "@/lib/ai/client";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { SecurityFinding } from "@/lib/gcp/types";

jest.mock("@/lib/github/client");
jest.mock("@/lib/ai/client");

const mockSearchTfFiles = searchTfFiles as jest.MockedFunction<typeof searchTfFiles>;
const mockGetFileContent = getFileContent as jest.MockedFunction<typeof getFileContent>;
const mockCallAI = callAI as jest.MockedFunction<typeof callAI>;

function makeAttackPath(overrides: Partial<AttackPath> = {}): AttackPath {
  return {
    id: "bucket-read:my-public-bucket",
    severity: "high",
    title: "Public Readable Bucket → Direct Data Exposure",
    description: "Bucket my-public-bucket grants public read access.",
    mitigations: ["Remove allUsers from IAM policy."],
    nodes: [
      {
        id: "internet",
        kind: "entry",
        resourceType: "internet",
        label: "Internet",
        detail: "Any unauthenticated user",
        projectId: "proj-1",
        risk: "No authentication required",
      },
      {
        id: "bucket:my-public-bucket",
        kind: "pivot",
        resourceType: "storage_bucket",
        label: "my-public-bucket",
        detail: "Public roles: storage.objectViewer",
        projectId: "proj-1",
        risk: "Publicly readable",
      },
    ],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: "public_firewall:proj-1:fw-open-ssh",
    severity: "critical",
    title: "Firewall Rule Open to the Internet",
    description: "Rule fw-open-ssh allows tcp:22 traffic from 0.0.0.0/0.",
    resourceName: "fw-open-ssh",
    projectId: "proj-1",
    resourceType: "firewall_rule",
    remediationHint: 'Restrict source ranges on rule "fw-open-ssh".',
    ...overrides,
  };
}

const TOKEN = "test-token";
const OWNER = "owner";
const REPO = "repo";
const PROVIDER = "google";
const API_KEY = "google-key";

const ORIGINAL_MAIN_TF = `
resource "google_storage_bucket" "my-public-bucket" {
  name = "my-public-bucket"
  iam_binding {
    role    = "roles/storage.objectViewer"
    members = ["allUsers"]
  }
}
`.trim();

const FIXED_MAIN_TF = `
resource "google_storage_bucket" "my-public-bucket" {
  name                     = "my-public-bucket"
  public_access_prevention = "enforced"
}
`.trim();

describe("buildRemediationPlan", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearRemediationCaches();
  });

  it("finds relevant files and returns patches when an attack path matches Terraform", async () => {
    mockSearchTfFiles.mockResolvedValue(["main.tf", "outputs.tf"]);
    mockGetFileContent
      .mockResolvedValueOnce({ content: ORIGINAL_MAIN_TF, sha: "sha-main" })
      .mockResolvedValueOnce({ content: 'output "bucket_name" { value = "unrelated-output" }', sha: "sha-outputs" });
    mockCallAI.mockResolvedValue(FIXED_MAIN_TF);

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromAttackPath(makeAttackPath())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("main.tf");
    expect(plan.patches[0].originalContent).not.toBe(plan.patches[0].fixedContent);
    expect(plan.fullyAddressed).toBe(true);
    expect(plan.uncoveredTargets).toEqual([]);
  });

  it("matches findings directly without converting them into fake attack paths", async () => {
    const firewallTf = `
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  project       = "proj-1"
  source_ranges = ["0.0.0.0/0"]
}
`.trim();
    const fixedFirewallTf = firewallTf.replace('["0.0.0.0/0"]', '["10.0.0.0/8"]');

    mockSearchTfFiles.mockResolvedValue(["firewall.tf"]);
    mockGetFileContent.mockResolvedValue({ content: firewallTf, sha: "sha-firewall" });
    mockCallAI.mockResolvedValue(fixedFirewallTf);

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromFinding(makeFinding())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("firewall.tf");
    expect(plan.fullyAddressed).toBe(true);
  });

  it("adds a guardrail for expired service account key findings", async () => {
    const target = remediationTargetFromFinding(makeFinding({
      id: "expired_sa_key:proj-1:user-sa@proj-1.iam.gserviceaccount.com",
      title: "Expired Service Account Key",
      description: 'Service account "user-sa@proj-1.iam.gserviceaccount.com" has 1 expired key(s).',
      resourceType: "service_account",
      resourceName: "user-sa@proj-1.iam.gserviceaccount.com",
      remediationHint: 'Rotate or delete expired keys for "user-sa@proj-1.iam.gserviceaccount.com" in the GCP Console > IAM > Service Accounts.',
    }));

    expect(target.promptDetails.join("\n")).toContain("Guard: only treat keys as expired");
    expect(target.promptDetails.join("\n")).toContain("Do not invent key IDs");
  });

  it("marks service-account key hygiene findings as manual review only", async () => {
    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromFinding(makeFinding({
          id: "multiple_sa_keys:proj-1:wm-attack-multikey-sa@proj-1.iam.gserviceaccount.com",
          title: "Service Account with Multiple Keys",
          description: "Service account has 9 user-managed keys.",
          resourceType: "service_account",
          resourceName: "wm-attack-multikey-sa@proj-1.iam.gserviceaccount.com",
        })),
      ],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(0);
    expect(plan.fullyAddressed).toBe(false);
    expect(plan.summary).toContain("manual review");
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it("skips files where AI returns identical content", async () => {
    mockSearchTfFiles.mockResolvedValue(["main.tf"]);
    mockGetFileContent.mockImplementation(async (_token, _owner, _repo, filePath) => {
      expect(filePath).toBe("main.tf");
      return { content: ORIGINAL_MAIN_TF, sha: "sha-main" };
    });
    mockCallAI
      .mockResolvedValueOnce(ORIGINAL_MAIN_TF)
      .mockResolvedValueOnce('resource "google_storage_bucket_iam_binding" "generated" {}');

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromAttackPath(makeAttackPath())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].isNewFile).toBe(true);
    expect(plan.fullyAddressed).toBe(true);
  });

  it("generates a new fix file when no Terraform file matches the selected targets", async () => {
    mockSearchTfFiles.mockResolvedValue(["unrelated.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: 'resource "google_project" "my_project" { name = "some-other-project" }',
      sha: "sha-unrelated",
    });
    mockCallAI.mockResolvedValue('resource "google_project_iam_binding" "fix" {}');

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromAttackPath(makeAttackPath())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("watchmen-security-fixes.tf");
    expect(plan.patches[0].isNewFile).toBe(true);
    expect(plan.fullyAddressed).toBe(true);
  });

  it("calls AI with prompt context for findings and attack paths", async () => {
    mockSearchTfFiles.mockResolvedValue(["main.tf"]);
    mockGetFileContent.mockImplementation(async (_token, _owner, _repo, filePath) => {
      expect(filePath).toBe("main.tf");
      return { content: ORIGINAL_MAIN_TF, sha: "sha-main" };
    });
    mockCallAI.mockResolvedValue(FIXED_MAIN_TF);

    await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromAttackPath(makeAttackPath()),
        remediationTargetFromFinding(makeFinding()),
      ],
      PROVIDER,
      API_KEY
    );

    expect(mockCallAI.mock.calls.length).toBeGreaterThanOrEqual(1);
    const prompts = mockCallAI.mock.calls.map(([, , prompt]) => prompt);
    expect(prompts.some((prompt) => prompt.includes("Public Readable Bucket"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("Firewall Rule Open to the Internet"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("fw-open-ssh"))).toBe(true);
  });

  it("prefers real infrastructure files over faulty test scenario files", async () => {
    const realMainTf = `
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["0.0.0.0/0"]
}
`.trim();
    const scenarioTf = `
resource "google_compute_firewall" "scenario-fw-open-ssh" {
  name          = "scenario-fw-open-ssh"
  source_ranges = ["0.0.0.0/0"]
}
`.trim();

    mockSearchTfFiles.mockResolvedValue([
      "gcp/attack-scenarios.tf",
      "gcp/faulty-test/security-issues-test.tf",
      "gcp/main.tf",
    ]);
    mockGetFileContent.mockImplementation(async (_token, _owner, _repo, filePath) => {
      if (filePath === "gcp/main.tf") return { content: realMainTf, sha: "sha-main" };
      return { content: scenarioTf, sha: `sha-${filePath}` };
    });
    mockCallAI.mockImplementation(async (_provider, _key, prompt) => {
      if (prompt.includes("File: gcp/main.tf")) {
        return realMainTf.replace('["0.0.0.0/0"]', '["10.0.0.0/8"]');
      }
      return scenarioTf;
    });

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromFinding(makeFinding())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("gcp/main.tf");
  });

  it("ignores backup snapshot Terraform paths when a live path exists", async () => {
    const liveMainTf = `
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["0.0.0.0/0"]
}
`.trim();

    mockSearchTfFiles.mockResolvedValue([
      "backup/2026-04-02-watchmen-test-live-snapshot/gcp/main.tf",
      "backup/2026-04-02-watchmen-test-live-snapshot/gcp/watchmen-test-fixes/main.tf",
      "gcp/main.tf",
    ]);
    mockGetFileContent.mockImplementation(async (_token, _owner, _repo, filePath) => {
      if (filePath !== "gcp/main.tf") {
        throw new Error(`Unexpected backup path fetched: ${filePath}`);
      }
      return { content: liveMainTf, sha: "sha-live-main" };
    });
    mockCallAI.mockResolvedValue(liveMainTf.replace('["0.0.0.0/0"]', '["10.0.0.0/8"]'));

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [remediationTargetFromFinding(makeFinding())],
      PROVIDER,
      API_KEY
    );

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("gcp/main.tf");
    expect(mockGetFileContent).toHaveBeenCalledTimes(1);
  });

  it("limits each file prompt to the most relevant findings", async () => {
    const manyFindings = Array.from({ length: 20 }, (_, index) =>
      remediationTargetFromFinding(
        makeFinding({
          id: `public_firewall:proj-1:fw-open-ssh-${index}`,
          title: `Firewall issue ${index}`,
          description: `Rule fw-open-ssh-${index} allows tcp:22 traffic from 0.0.0.0/0 and should be remediated immediately.`,
          resourceName: index < 10 ? "fw-open-ssh" : `other-rule-${index}`,
        })
      )
    );

    mockSearchTfFiles.mockResolvedValue(["gcp/main.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: `
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["0.0.0.0/0"]
}
`.trim(),
      sha: "sha-main",
    });
    mockCallAI.mockResolvedValue(`
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["10.0.0.0/8"]
}
`.trim());

    await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      manyFindings,
      PROVIDER,
      API_KEY
    );

    expect(mockCallAI.mock.calls.length).toBeGreaterThanOrEqual(1);
    const prompt = mockCallAI.mock.calls[0][2];
    expect(prompt).toContain("fw-open-ssh");
    expect(prompt).not.toContain("Firewall issue 19");
  });

  it("reports uncovered targets when only part of the selection yields patches", async () => {
    mockSearchTfFiles.mockResolvedValue(["gcp/main.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: `
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["0.0.0.0/0"]
}
`.trim(),
      sha: "sha-main",
    });
    mockCallAI
      .mockResolvedValueOnce(`
resource "google_compute_firewall" "fw-open-ssh" {
  name          = "fw-open-ssh"
  source_ranges = ["10.0.0.0/8"]
}
`.trim())
      .mockResolvedValueOnce("");

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromFinding(makeFinding()),
        remediationTargetFromFinding(makeFinding({
          id: "sa_not_in_list:service-123@compute-system.iam.gserviceaccount.com",
          title: "Service account not in approved list",
          description: "Unexpected service account detected.",
          resourceType: "service_account",
          resourceName: "service-123@compute-system.iam.gserviceaccount.com",
          remediationHint: "Review whether this service account should remain active.",
        })),
      ],
      PROVIDER,
      API_KEY
    );

    expect(plan.fullyAddressed).toBe(false);
    expect(plan.coveredTargetIds).toContain("public_firewall:proj-1:fw-open-ssh");
    expect(plan.uncoveredTargets.map((target) => target.id)).toContain("sa_not_in_list:service-123@compute-system.iam.gserviceaccount.com");
  });

  it("filters unrelated targets out of a file prompt", async () => {
    mockSearchTfFiles.mockResolvedValue(["gcp/iam.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: `
resource "google_project_iam_member" "viewer" {
  project = "proj-1"
  role    = "roles/viewer"
  member  = "user:test@example.com"
}
`.trim(),
      sha: "sha-iam",
    });
    mockCallAI.mockResolvedValue(`
resource "google_project_iam_member" "viewer" {
  project = "proj-1"
  role    = "roles/viewer"
  member  = "user:test@example.com"
}
`.trim());

    await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromFinding(makeFinding()),
        remediationTargetFromAttackPath(makeAttackPath({
          id: "user-lateral:test@example.com",
          title: "User lateral movement through IAM",
          description: "User test@example.com can pivot through broad IAM access.",
          mitigations: ["Reduce IAM privileges."],
          nodes: [
            {
              id: "user:test@example.com",
              kind: "entry",
              resourceType: "iam",
              label: "test@example.com",
              detail: "User has project IAM access",
              projectId: "proj-1",
              risk: "Lateral movement",
            },
          ],
        })),
      ],
      PROVIDER,
      API_KEY
    );

    const prompt = mockCallAI.mock.calls[0][2];
    expect(prompt).toContain("User lateral movement through IAM");
    expect(prompt).not.toContain("Firewall Rule Open to the Internet");
  });

  it("skips fallback generation for abstract uncovered targets", async () => {
    mockSearchTfFiles.mockResolvedValue(["gcp/iam.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: `
resource "google_project_iam_member" "viewer" {
  project = "proj-1"
  role    = "roles/viewer"
  member  = "user:test@example.com"
}
`.trim(),
      sha: "sha-iam",
    });
    mockCallAI.mockResolvedValue(`
resource "google_project_iam_member" "viewer" {
  project = "proj-1"
  role    = "roles/viewer"
  member  = "user:test@example.com"
}
`.trim());

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromAttackPath(makeAttackPath({
          id: "abstract-risk",
          title: "Abstract lateral risk",
          description: "A risky identity graph exists.",
          mitigations: ["Investigate manually."],
          nodes: [
            {
              id: "abstract",
              kind: "entry",
              resourceType: "unknown",
              label: "abstract-node",
              detail: "No concrete Terraform resource",
              projectId: "proj-1",
              risk: "Unknown",
            },
          ],
        })),
      ],
      PROVIDER,
      API_KEY
    );

    expect(plan.fullyAddressed).toBe(false);
    expect(plan.uncoveredTargets).toHaveLength(1);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
  });

  it("marks sa_not_in_list targets as manual review only", async () => {
    mockSearchTfFiles.mockResolvedValue(["gcp/compute.tf"]);
    mockGetFileContent.mockResolvedValue({
      content: `
resource "google_compute_instance" "vm" {
  name = "vm"
}
`.trim(),
      sha: "sha-compute",
    });

    const plan = await buildRemediationPlan(
      TOKEN,
      OWNER,
      REPO,
      [
        remediationTargetFromFinding(makeFinding({
          id: "sa_not_in_list:service-123@compute-system.iam.gserviceaccount.com",
          title: "Service account not in approved list",
          description: "Unexpected service account detected.",
          resourceType: "service_account",
          resourceName: "service-123@compute-system.iam.gserviceaccount.com",
        })),
      ],
      PROVIDER,
      API_KEY
    );

    expect(plan.fullyAddressed).toBe(false);
    expect(plan.summary).toContain("manual review");
    expect(mockCallAI).not.toHaveBeenCalled();
  });
});
