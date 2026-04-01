import { buildRemediationPlan } from "@/lib/github/terraform-remediation";
import { searchTfFiles, getFileContent } from "@/lib/github/client";
import { callAI } from "@/lib/ai/client";
import type { AttackPath } from "@/lib/gcp/attack-paths";

jest.mock("@/lib/github/client");
jest.mock("@/lib/ai/client");

const mockSearchTfFiles = searchTfFiles as jest.MockedFunction<typeof searchTfFiles>;
const mockGetFileContent = getFileContent as jest.MockedFunction<typeof getFileContent>;
const mockCallAI = callAI as jest.MockedFunction<typeof callAI>;

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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

const TOKEN = "test-token";
const OWNER = "owner";
const REPO = "repo";
const GEMINI_KEY = "gemini-key";

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
  name = "my-public-bucket"
}
`.trim();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildRemediationPlan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Finds relevant files and returns patches ────────────────────────────
  it("finds relevant files and returns patches when AI produces different content", async () => {
    const outputsTf = `output "bucket_name" { value = "unrelated-output" }`;

    mockSearchTfFiles.mockResolvedValue(["main.tf", "outputs.tf"]);
    mockGetFileContent
      .mockResolvedValueOnce({ content: ORIGINAL_MAIN_TF, sha: "sha-main" })
      .mockResolvedValueOnce({ content: outputsTf, sha: "sha-outputs" });
    mockCallAI.mockResolvedValue(FIXED_MAIN_TF);

    const path = makeAttackPath();
    const plan = await buildRemediationPlan(TOKEN, OWNER, REPO, [path], GEMINI_KEY);

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toBe("main.tf");
    expect(plan.patches[0].originalContent).not.toBe(plan.patches[0].fixedContent);
  });

  // ── 2. Skips files where AI returns identical content ─────────────────────
  it("skips files where AI returns identical content", async () => {
    mockSearchTfFiles.mockResolvedValue(["main.tf"]);
    mockGetFileContent.mockResolvedValue({ content: ORIGINAL_MAIN_TF, sha: "sha-main" });
    // AI returns the exact same content (trimmed)
    mockCallAI.mockResolvedValue(ORIGINAL_MAIN_TF);

    const path = makeAttackPath();
    const plan = await buildRemediationPlan(TOKEN, OWNER, REPO, [path], GEMINI_KEY);

    expect(plan.patches).toHaveLength(0);
  });

  // ── 3. Handles multiple attack paths across multiple files ─────────────────
  it("returns patches for multiple relevant files across multiple attack paths", async () => {
    const bucketTf = `resource "google_storage_bucket" "my-public-bucket" { name = "my-public-bucket" }`;
    const firewallTf = `resource "google_compute_firewall" "fw-open-ssh" { name = "fw-open-ssh" }`;

    const fixedBucketTf = `resource "google_storage_bucket" "my-public-bucket" { name = "my-public-bucket" /* fixed */ }`;
    const fixedFirewallTf = `resource "google_compute_firewall" "fw-open-ssh" { name = "fw-open-ssh" /* fixed */ }`;

    mockSearchTfFiles.mockResolvedValue(["bucket.tf", "firewall.tf"]);
    mockGetFileContent
      .mockResolvedValueOnce({ content: bucketTf, sha: "sha-bucket" })
      .mockResolvedValueOnce({ content: firewallTf, sha: "sha-firewall" });
    mockCallAI
      .mockResolvedValueOnce(fixedBucketTf)
      .mockResolvedValueOnce(fixedFirewallTf);

    const bucketPath = makeAttackPath({
      id: "bucket-read:my-public-bucket",
      nodes: [
        { id: "bucket:my-public-bucket", kind: "pivot", resourceType: "storage_bucket", label: "my-public-bucket", detail: "", projectId: "proj-1", risk: "" },
      ],
    });

    const fwPath = makeAttackPath({
      id: "fw-vm-sa:fw-open-ssh:my-vm",
      title: "Internet → Open Firewall → VM → Privileged SA",
      nodes: [
        { id: "fw:fw-open-ssh", kind: "entry", resourceType: "firewall_rule", label: "fw-open-ssh", detail: "", projectId: "proj-1", risk: "" },
      ],
    });

    const plan = await buildRemediationPlan(TOKEN, OWNER, REPO, [bucketPath, fwPath], GEMINI_KEY);

    expect(plan.patches).toHaveLength(2);
  });

  // ── 4. Returns empty patches when no TF files match any resource ───────────
  it("returns empty patches and a defined summary when no TF file matches attack path resources", async () => {
    const unrelatedTf = `resource "google_project" "my_project" { name = "some-other-project" }`;

    mockSearchTfFiles.mockResolvedValue(["unrelated.tf"]);
    mockGetFileContent.mockResolvedValue({ content: unrelatedTf, sha: "sha-unrelated" });

    const path = makeAttackPath();
    const plan = await buildRemediationPlan(TOKEN, OWNER, REPO, [path], GEMINI_KEY);

    expect(plan.patches).toHaveLength(0);
    expect(plan.summary).toBeDefined();
    expect(typeof plan.summary).toBe("string");
    // AI should not have been called since no files matched
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  // ── 5. Calls AI with the attack path title in the prompt ──────────────────
  it("calls AI with a prompt containing the attack path title", async () => {
    mockSearchTfFiles.mockResolvedValue(["main.tf"]);
    mockGetFileContent.mockResolvedValue({ content: ORIGINAL_MAIN_TF, sha: "sha-main" });
    mockCallAI.mockResolvedValue(FIXED_MAIN_TF);

    const path = makeAttackPath({
      title: "Public Readable Bucket → Direct Data Exposure",
    });

    await buildRemediationPlan(TOKEN, OWNER, REPO, [path], GEMINI_KEY);

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    const [, , prompt] = mockCallAI.mock.calls[0];
    expect(prompt).toContain("Public Readable Bucket → Direct Data Exposure");
  });
});
