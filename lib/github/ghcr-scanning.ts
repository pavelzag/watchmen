import { ImageScanResult, ContainerVulnerability, CveSeverity } from "../container-scanning";

import { getUserCloudCredentials } from "../credentials";

export async function getGhcrVulnerabilities(userEmail?: string): Promise<ImageScanResult[]> {
  let token = process.env.GITHUB_TOKEN;
  let owner = process.env.GITHUB_ORG || "pavelzag";

  if (userEmail) {
    const creds = await getUserCloudCredentials(userEmail, "ghcr");
    if (creds?.token) token = creds.token;
  }

  if (!token) {
    console.info("[ghcr] skipping: GITHUB_TOKEN not configured");
    return [];
  }

  try {
    const query = `
      query {
        organization(login: "${owner}") {
          repositories(first: 10, orderBy: {field: PUSHED_AT, direction: DESC}) {
            nodes {
              name
              vulnerabilityAlerts(first: 50, states: OPEN) {
                nodes {
                  securityVulnerability {
                    advisory {
                      summary
                      severity
                      cvss { score }
                      identifiers { type value }
                    }
                    package { name }
                    vulnerableVersionRange
                    firstPatchedVersion { identifier }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      next: { revalidate: 300 },
    });

    const body = await res.json();
    if (body.errors) {
      console.warn("[ghcr] GraphQL error:", body.errors);
      return [];
    }

    const repos = body.data?.organization?.repositories?.nodes ?? [];
    const results: ImageScanResult[] = [];

    for (const repo of repos) {
      const alerts = repo.vulnerabilityAlerts?.nodes ?? [];
      if (alerts.length === 0) continue;

      let critical = 0,
        high = 0,
        medium = 0,
        low = 0,
        negligible = 0;
      const vulnerabilities: ContainerVulnerability[] = [];

      for (const alert of alerts) {
        const sv = alert.securityVulnerability;
        if (!sv) continue;
        const adv = sv.advisory;
        const cveId = adv.identifiers.find((i: any) => i.type === "CVE")?.value ?? "Unknown";

        let severity: CveSeverity = "medium";
        if (adv.severity === "CRITICAL") severity = "critical";
        else if (adv.severity === "HIGH") severity = "high";
        else if (adv.severity === "MODERATE") severity = "medium";
        else if (adv.severity === "LOW") severity = "low";

        vulnerabilities.push({
          cveId,
          severity,
          packageName: sv.package.name,
          installedVersion: sv.vulnerableVersionRange,
          fixedVersion: sv.firstPatchedVersion?.identifier,
          description: adv.summary,
          cvssScore: adv.cvss?.score,
        });

        if (severity === "critical") critical++;
        else if (severity === "high") high++;
        else if (severity === "medium") medium++;
        else if (severity === "low") low++;
        else negligible++;
      }

      results.push({
        imageRef: `ghcr.io/${owner}/${repo.name}:latest`,
        imageName: `${repo.name}:latest`,
        cloud: "ghcr",
        accountId: owner,
        scannedAt: new Date().toISOString(),
        vulnerabilities,
        summary: { critical, high, medium, low, negligible },
      });
    }

    return results;
  } catch (error) {
    console.info(`[ghcr] skipping: ${error}`);
    return [];
  }
}
