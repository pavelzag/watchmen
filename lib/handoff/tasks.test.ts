import {
  buildCliCommandsForTask,
  buildHandoffTaskDrafts,
  buildTasksMarkdownPack,
  computeTaskFingerprint,
  handoffIssueFromAttackPath,
  handoffIssueFromFinding,
  redactHandoffText,
} from "@/lib/handoff/tasks";
import type { SecurityFinding } from "@/lib/gcp/types";
import type { AttackPath } from "@/lib/gcp/attack-paths";

describe("lib/handoff/tasks", () => {
  it("redacts connection string passwords, keys, and tokens from exported text", () => {
    const raw = [
      "DATABASE_URL=postgresql://admin:SuperSecretPass123!@10.0.0.5:5432/prod",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
      "GOOGLE_KEY=AIzaSyDummyKeyValue1234567890",
      "OPENAI=sk-proj-1234567890abcdef123456",
      "AWS=AKIAIOSFODNN7EXAMPLE",
      "WATCHMEN=wm_0123456789abcdef0123456789abcdef",
    ].join("\n");

    const redacted = redactHandoffText(raw);
    expect(redacted).not.toContain("SuperSecretPass123!");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(redacted).not.toContain("AIzaSyDummyKeyValue1234567890");
    expect(redacted).not.toContain("sk-proj-1234567890abcdef123456");
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).not.toContain("wm_0123456789abcdef0123456789abcdef");
    expect(redacted).toContain("[REDACTED]");
  });

  it("groups findings by category, combines, or splits individually", () => {
    const fwFinding: SecurityFinding = {
      id: "public_firewall:proj-1:allow-ssh",
      severity: "critical",
      title: "Firewall Rule Open to the Internet",
      description: "Allows 0.0.0.0/0 on port 22",
      resourceName: "allow-ssh",
      projectId: "proj-1",
      resourceType: "firewall_rule",
      remediationHint: "Restrict sourceRanges",
    };

    const bucketFinding: SecurityFinding = {
      id: "public_bucket:proj-1:logs-bucket",
      severity: "high",
      title: "Publicly Accessible Storage Bucket",
      description: "Grants allUsers access",
      resourceName: "logs-bucket",
      projectId: "proj-1",
      resourceType: "storage_bucket",
      remediationHint: "Remove allUsers binding",
    };

    const issues = [
      handoffIssueFromFinding({ ...fwFinding, cloud: "gcp" }, { investigationReport: "Confirmed open to internet." }),
      handoffIssueFromFinding({ ...bucketFinding, cloud: "gcp" }),
    ];

    const grouped = buildHandoffTaskDrafts({ issues, batchMode: "grouped", targetTool: "opencode" });
    expect(grouped).toHaveLength(2);
    expect(grouped[0].promptMarkdown).toContain("Confirmed open to internet.");

    const combined = buildHandoffTaskDrafts({ issues, batchMode: "combined", targetTool: "claude" });
    expect(combined).toHaveLength(1);
    expect(combined[0].severity).toBe("critical");
    expect(combined[0].issueCount).toBe(2);

    const individual = buildHandoffTaskDrafts({ issues, batchMode: "individual", targetTool: "codex" });
    expect(individual).toHaveLength(2);
    expect(individual[0].issueCount).toBe(1);
  });

  it("converts attack paths into handoff issues and computes deterministic fingerprints", () => {
    const attackPath: AttackPath = {
      id: "ap:proj-1:fw-to-sa",
      severity: "critical",
      title: "Internet -> VM -> Admin SA",
      description: "Exposed SSH leads to privileged service account.",
      nodes: [
        {
          id: "n1",
          kind: "entry",
          resourceType: "firewall_rule",
          label: "fw-ssh",
          detail: "0.0.0.0/0:22",
          projectId: "proj-1",
          risk: "Open SSH",
        },
      ],
      mitigations: ["Restrict SSH to IAP"],
    };

    const issue = handoffIssueFromAttackPath({ ...attackPath, cloud: "gcp" });
    expect(issue.kind).toBe("attack_path");
    expect(issue.projectId).toBe("proj-1");

    const fp1 = computeTaskFingerprint("grouped", ["b", "a"]);
    const fp2 = computeTaskFingerprint("grouped", ["a", "b"]);
    expect(fp1).toBe(fp2);
  });

  it("generates CLI commands for opencode, claude, codex, and markdown packs", () => {
    const cmdsApi = buildCliCommandsForTask({
      taskId: "wm_tsk_abc123",
      title: "Firewall issues",
      promptMarkdown: "# Prompt body",
      origin: "https://watchmen.example.com/",
      preferApiFetch: true,
    });

    expect(cmdsApi.opencode).toContain("opencode run ");
    expect(cmdsApi.opencode).toContain("https://watchmen.example.com/api/handoff/tasks/wm_tsk_abc123");
    expect(cmdsApi.claude).toContain("claude ");
    expect(cmdsApi.claudeHeadless).toContain("claude -p ");
    expect(cmdsApi.codex).toContain("codex ");
    expect(cmdsApi.codexHeadless).toContain("codex exec ");
    expect(cmdsApi.curl).toContain("Authorization: Bearer $WATCHMEN_API_TOKEN");

    const pack = buildTasksMarkdownPack([
      { id: "wm_tsk_abc123", title: "Firewall issues", severity: "critical", promptMarkdown: "# Task 1" },
    ]);
    expect(pack).toContain("Watchmen Security Task Pack (v0.9)");
    expect(pack).toContain("wm_tsk_abc123");
  });
});
