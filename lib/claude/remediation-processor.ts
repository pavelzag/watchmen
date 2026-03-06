import { AIProvider, callAI } from "@/lib/ai/client";

export async function generateRemediation(
    vulnerability: { title: string; description: string; remediation: string },
    provider: AIProvider,
    apiKey: string
): Promise<{ script: string; explanation: string }> {
    const prompt = `You are a Cloud Security Engineer. Generate a technical remediation script and a brief explanation for the following vulnerability.
  
  Vulnerability: ${vulnerability.title}
  Description: ${vulnerability.description}
  Intent: ${vulnerability.remediation}
  
  Return ONLY a JSON object with this structure:
  {
    "script": "<CLI command, Terraform snippet, or bash script>",
    "explanation": "<2-3 sentence explanation of why this fix is necessary>"
  }
  
  Focus on the most direct fix (e.g., gcloud, aws cli, or kubectl).`;

    const text = await callAI(provider, apiKey, prompt);
    const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        return {
            script: `# Manual Fix Required\n${vulnerability.remediation}`,
            explanation: "Failed to generate automated script. Please follow the manual remediation steps."
        };
    }
}
