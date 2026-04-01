import type { AttackPath } from "@/lib/gcp/attack-paths";
import { callAI } from "@/lib/ai/client";
import {
  searchTfFiles,
  getFileContent,
} from "@/lib/github/client";

export interface TfFilePatch {
  path: string;
  originalContent: string;
  fixedContent: string;
  sha: string;
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
 * Build a Gemini prompt for remediating a specific Terraform file.
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
  geminiApiKey: string
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

  if (relevantPaths.length === 0) {
    return {
      patches: [],
      summary: "No Terraform files matched the resources in the selected attack paths.",
    };
  }

  // Step 4: Call Gemini for each relevant file
  const patches: TfFilePatch[] = [];

  for (const filePath of relevantPaths) {
    const { content: originalContent, sha } = fileMap.get(filePath)!;
    const prompt = buildPrompt(filePath, originalContent, paths);

    let fixedContent: string;
    try {
      fixedContent = await callAI("google", geminiApiKey, prompt);
    } catch {
      // Skip files where AI call fails
      continue;
    }

    // Step 5: Only include files that actually changed
    const trimmedFixed = fixedContent.trim();
    if (trimmedFixed && trimmedFixed !== originalContent.trim()) {
      patches.push({
        path: filePath,
        originalContent,
        fixedContent: trimmedFixed,
        sha,
      });
    }
  }

  const summary =
    patches.length === 0
      ? "AI analysis found no changes needed in the matched Terraform files."
      : `Found ${patches.length} file${patches.length === 1 ? "" : "s"} to update across ${relevantPaths.length} matched Terraform file${relevantPaths.length === 1 ? "" : "s"}. Addressing ${paths.length} attack path${paths.length === 1 ? "" : "s"}.`;

  return { patches, summary };
}
