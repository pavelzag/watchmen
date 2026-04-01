import type { AttackPath } from "@/lib/gcp/attack-paths";
import { callAI, type AIProvider } from "@/lib/ai/client";
import {
  searchTfFiles,
  getFileContent,
} from "@/lib/github/client";

export interface TfFilePatch {
  path: string;
  originalContent: string;
  fixedContent: string;
  sha: string;
  isNewFile?: boolean;
}

export interface RemediationPlan {
  patches: TfFilePatch[];
  summary: string;
}

/**
 * Identify which .tf files are likely relevant to a given set of attack paths
 * by looking for resource labels (bucket names, firewall names, etc.) in the file content.
 */
function isFileRelevant(
  content: string,
  paths: AttackPath[]
): boolean {
  for (const path of paths) {
    for (const node of path.nodes) {
      const label = node.label.trim();
      if (!label || label === "Internet" || label === "Bucket Contents") continue;

      // Strip common prefixes/suffixes for matching (e.g. "projects/foo/secrets/bar" → "bar")
      const shortLabel = label.includes("/") ? label.split("/").pop()! : label;

      if (shortLabel.length > 3 && content.includes(shortLabel)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build a prompt to generate a new Terraform file that remediates the attack paths.
 */
function buildNewFilePrompt(paths: AttackPath[]): string {
  const pathDescriptions = paths
    .map((p) => `- ${p.title}: ${p.description}`)
    .join("\n");

  return `You are a Terraform security expert. The following security attack paths were detected in a GCP environment:

${pathDescriptions}

Generate a new Terraform file called "watchmen-security-fixes.tf" that addresses these security issues.
Rules:
- Create Google Cloud IAM bindings, firewall rules, and other resources to remediate the issues
- Apply the principle of least privilege
- Use "watchmen-" as a prefix for resource names
- Include only resources that directly fix the detected issues
- Return ONLY the complete Terraform file content, no markdown fences, no explanation`;
}

/**
 * Build a prompt for remediating a specific Terraform file.
 */
function buildPrompt(filePath: string, fileContent: string, paths: AttackPath[]): string {
  const pathDescriptions = paths
    .map((p) => `- ${p.title}: ${p.description}`)
    .join("\n");

  return `You are a Terraform security expert. The following security attack paths were detected:

${pathDescriptions}

Fix the Terraform file below to remediate these issues. Apply the principle of least privilege.
Rules:
- Remove or restrict overly permissive IAM bindings (allUsers, allAuthenticatedUsers)
- Change source_ranges from 0.0.0.0/0 to 10.0.0.0/8 for internal firewall rules
- Keep all other resources exactly as-is
- Return ONLY the complete fixed file content, no markdown fences, no explanation

File: ${filePath}
${fileContent}`;
}

async function generateNewSecurityFile(
  paths: AttackPath[],
  aiProvider: AIProvider,
  aiApiKey: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    const content = await Promise.race([
      callAI(aiProvider, aiApiKey, buildNewFilePrompt(paths)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI timed out")), timeoutMs)
      ),
    ]);
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Build a remediation plan by:
 * 1. Listing all .tf files in the repo
 * 2. Fetching each file's content
 * 3. Determining which files are relevant to the attack paths
 * 4. Calling Gemini to generate fixes for relevant files
 * 5. Returning patches for files that actually changed
 */
export async function buildRemediationPlan(
  token: string,
  owner: string,
  repo: string,
  paths: AttackPath[],
  aiProvider: AIProvider,
  aiApiKey: string
): Promise<RemediationPlan> {
  // Step 1: Get all .tf file paths
  const tfPaths = await searchTfFiles(token, owner, repo);

  if (tfPaths.length === 0) {
    return {
      patches: [],
      summary: "No Terraform files found in this repository.",
    };
  }

  // Step 2: Fetch content for all .tf files
  const fileMap = new Map<string, { content: string; sha: string }>();
  await Promise.all(
    tfPaths.map(async (filePath) => {
      try {
        const data = await getFileContent(token, owner, repo, filePath);
        fileMap.set(filePath, data);
      } catch {
        // Skip files that can't be fetched (e.g., LFS pointers, permission issues)
      }
    })
  );

  // Step 3: Filter to relevant files
  const relevantPaths: string[] = [];
  for (const [filePath, { content }] of fileMap) {
    if (isFileRelevant(content, paths)) {
      relevantPaths.push(filePath);
    }
  }

  const AI_TIMEOUT_MS = 45_000;

  // Step 4: If no files matched, generate a new security fixes file
  if (relevantPaths.length === 0) {
    const newFileContent = await generateNewSecurityFile(paths, aiProvider, aiApiKey, AI_TIMEOUT_MS);
    if (!newFileContent) {
      return { patches: [], summary: "No Terraform files matched the selected attack paths and AI could not generate a fix." };
    }
    return {
      patches: [{ path: "watchmen-security-fixes.tf", originalContent: "", fixedContent: newFileContent, sha: "", isNewFile: true }],
      summary: "No existing Terraform files matched. Generated a new watchmen-security-fixes.tf to remediate the attack paths.",
    };
  }

  // Step 5: Call AI for each relevant file (cap at 5 to avoid runaway requests)
  const patches: TfFilePatch[] = [];
  const MAX_FILES = 5;

  for (const filePath of relevantPaths.slice(0, MAX_FILES)) {
    const { content: originalContent, sha } = fileMap.get(filePath)!;

    // Skip files over 200 KB — prompt would be too large
    if (originalContent.length > 200_000) continue;

    const prompt = buildPrompt(filePath, originalContent, paths);

    let fixedContent: string;
    try {
      fixedContent = await Promise.race([
        callAI(aiProvider, aiApiKey, prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI timed out")), AI_TIMEOUT_MS)
        ),
      ]);
    } catch {
      // Skip files where AI call fails or times out
      continue;
    }

    // Step 6: Only include files that actually changed
    const trimmedFixed = fixedContent.trim();
    if (trimmedFixed && trimmedFixed !== originalContent.trim()) {
      patches.push({ path: filePath, originalContent, fixedContent: trimmedFixed, sha });
    }
  }

  // Step 7: If AI found no changes in matched files, generate a new file as fallback
  if (patches.length === 0) {
    const newFileContent = await generateNewSecurityFile(paths, aiProvider, aiApiKey, AI_TIMEOUT_MS);
    if (newFileContent) {
      return {
        patches: [{ path: "watchmen-security-fixes.tf", originalContent: "", fixedContent: newFileContent, sha: "", isNewFile: true }],
        summary: "Matched Terraform files needed no changes. Generated a new watchmen-security-fixes.tf to remediate the attack paths.",
      };
    }
  }

  const summary = `Found ${patches.length} file${patches.length === 1 ? "" : "s"} to update across ${relevantPaths.length} matched Terraform file${relevantPaths.length === 1 ? "" : "s"}. Addressing ${paths.length} attack path${paths.length === 1 ? "" : "s"}.`;
  return { patches, summary };
}
