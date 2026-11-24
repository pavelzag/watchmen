import type { HandoffIssueItem } from "@/lib/handoff/tasks";

export type ShirudoShieldKind = "bpf_upatch" | "java_agent" | "hybrid";

const JAVA_HINT_RE = /\b(java|jdk|openjdk|jvm|elasticsearch|log4j|spring|tomcat|jackson|base64|netty|kafka)\b/i;

export function inferShirudoShieldKind(issues: HandoffIssueItem[]): ShirudoShieldKind {
  let hasJava = false;
  let hasNonJava = false;

  for (const issue of issues) {
    const haystack = [
      issue.title,
      issue.description,
      issue.resourceName,
      issue.resourceType ?? "",
      issue.remediationHint ?? "",
    ].join(" ");
    if (JAVA_HINT_RE.test(haystack)) {
      hasJava = true;
    } else {
      hasNonJava = true;
    }
  }

  if (hasJava && hasNonJava) return "hybrid";
  if (hasJava) return "java_agent";
  return "bpf_upatch";
}

function slugifyPackageName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "watchmen-shield";
}

export function extractAdvisoryIds(issues: HandoffIssueItem[]): string[] {
  const ids = new Set<string>();
  for (const issue of issues) {
    const matches = `${issue.id} ${issue.title} ${issue.description}`.match(/\bCVE-\d{4}-\d{4,7}\b/gi);
    if (matches) {
      for (const m of matches) {
        ids.add(m.toUpperCase());
      }
    }
  }
  return [...ids];
}

export function buildShirudoBeefileTemplate(params: {
  title: string;
  issues: HandoffIssueItem[];
}): string {
  const pkgName = slugifyPackageName(`wm-${params.title}`);
  const shieldKind = inferShirudoShieldKind(params.issues);
  const advisories = extractAdvisoryIds(params.issues);
  const fixesLine =
    advisories.length > 0
      ? `fixes = [${advisories.map((id) => `"${id}"`).join(", ")}]`
      : `# fixes = ["CVE-YYYY-NNNN"]`;

  if (shieldKind === "java_agent") {
    return [
      `# Starter Shirudo Beefile (Java agent upatch)`,
      `name = "${pkgName}"`,
      `version = "0.1.0"`,
      `description = "Watchmen-generated live Java shield"`,
      fixesLine,
      ``,
      `[[upatch]]`,
      `id = "${pkgName}"`,
      `type = "java-agent"`,
      `source = "java/${pkgName}.java"`,
    ].join("\n");
  }

  return [
    `# Starter Shirudo Beefile (BPF C upatch)`,
    `name = "${pkgName}"`,
    `version = "0.1.0"`,
    `description = "Watchmen-generated live eBPF shield"`,
    fixesLine,
    ``,
    `[[upatch]]`,
    `id = "${pkgName}"`,
    `source = "bpf/${pkgName}.bpf.c"`,
    `# Example attach targets: fentry/..., fmod_ret/..., lsm/..., kprobe/...`,
  ].join("\n");
}

export function renderShirudoShieldInstructions(params: {
  title: string;
  issues: HandoffIssueItem[];
}): string[] {
  const shieldKind = inferShirudoShieldKind(params.issues);
  const beefile = buildShirudoBeefileTemplate(params);

  const strategyLine =
    shieldKind === "java_agent"
      ? "Recommended shield type: **Java agent upatch** (JVM / OpenJDK bytecode guard, e.g., validating untrusted decoder/input paths without restarting the service)."
      : shieldKind === "hybrid"
        ? "Recommended shield type: **Hybrid (BPF C upatch + Java agent upatch)** depending on whether each issue lives in Linux/native code or a JVM runtime."
        : "Recommended shield type: **BPF C upatch** (`fentry` / `fmod_ret` / `lsm` / `uprobe` using CO-RE against the target `vmlinux.h`) blocking only the vulnerable path without breaking legitimate requests.";

  return [
    "## Instructions for Coding Agent (Shirudo Live-Shield Mode)",
    `1. ${strategyLine}`,
    "2. Inspect the workload/repository and understand the exact vulnerable code path or live attack vector listed below.",
    "3. Write:",
    "   - A minimal, targeted Shirudo `upatch` (blocking only the exploit condition while allowing legitimate traffic).",
    "   - An **exploit reproducer test** + a **legitimate-traffic regression test** proving the shield blocks the attack with zero service disruption.",
    "   - A `Beefile` + unload directive so the shield can be cleanly rolled back once the permanent OS/package patch is deployed.",
    "4. Build and test locally in a Shirudo VM (`shirudo build`, `shirudo bpm build`, `shirudo upatch load`).",
    "5. **Security boundary (required):** NEVER commit or embed private ML-DSA-87 signing keys in the repository. Stop and ask a human operator for explicit approval before signing or running `shirudo bpm push` to an OCI registry.",
    "",
    "### Starter `Beefile` Template",
    "```toml",
    beefile,
    "```",
  ];
}
