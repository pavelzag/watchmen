import {
  ECRClient,
  paginateDescribeRepositories,
  DescribeImagesCommand,
  DescribeImageScanFindingsCommand,
} from "@aws-sdk/client-ecr";
import { getAwsClientOptions } from "./client";
import { ImageScanResult, ContainerVulnerability, CveSeverity } from "../container-scanning";

function mapAwsSeverity(awsSev?: string): CveSeverity {
  switch (awsSev?.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    case "INFORMATIONAL":
    case "UNTRIAGED":
    default:
      return "negligible";
  }
}

export async function getAwsContainerVulnerabilities(region: string): Promise<ImageScanResult[]> {
  const options = getAwsClientOptions(region);
  const client = new ECRClient(options);
  const results: ImageScanResult[] = [];

  try {
    const repos = [];
    for await (const page of paginateDescribeRepositories({ client }, {})) {
      if (page.repositories) repos.push(...page.repositories);
    }

    for (const repo of repos) {
      if (!repo.repositoryName || !repo.registryId) continue;

      try {
        const imagesRes = await client.send(
          new DescribeImagesCommand({
            repositoryName: repo.repositoryName,
            filter: { tagStatus: "TAGGED" },
            maxResults: 5, // Process up to 5 most recent tagged images per repo
          })
        );

        const images = imagesRes.imageDetails ?? [];

        for (const img of images) {
          // If the image hasn't been scanned or isn't complete, we might not have findings
          if (img.imageScanStatus?.status !== "COMPLETE") continue;

          // Check if there are any findings
          const summaryCounts = img.imageScanFindingsSummary?.findingSeverityCounts;
          const totalFindings = Object.values(summaryCounts ?? {}).reduce((s, c) => s + c, 0);

          let vulnerabilities: ContainerVulnerability[] = [];

          if (totalFindings > 0 && img.imageTags && img.imageTags.length > 0) {
            const scanRes = await client.send(
              new DescribeImageScanFindingsCommand({
                repositoryName: repo.repositoryName,
                imageId: { imageTag: img.imageTags[0] },
                maxResults: 1000,
              })
            );

            const findings = scanRes.imageScanFindings?.findings ?? scanRes.imageScanFindings?.enhancedFindings ?? [];
            for (const f of findings) {
              if ('packageVulnerabilityDetails' in f) {
                // Enhanced finding
                const enhanced = f as any;
                const pkg = enhanced.packageVulnerabilityDetails;
                vulnerabilities.push({
                  cveId: enhanced.title ?? enhanced.name ?? "Unknown CVE",
                  severity: mapAwsSeverity(enhanced.severity),
                  packageName: pkg?.vulnerablePackages?.[0]?.name ?? "Unknown package",
                  installedVersion: pkg?.vulnerablePackages?.[0]?.version ?? "Unknown version",
                  fixedVersion: pkg?.vulnerablePackages?.[0]?.fixedInVersion,
                  description: enhanced.description || enhanced.title || "No description",
                  cvssScore: pkg?.cvss?.[0]?.scoreSource === "NVD" ? pkg.cvss[0].baseScore : undefined,
                });
              } else {
                // Basic finding
                const basic = f as any;
                const attr = basic.attributes?.reduce((acc: any, a: any) => {
                  if (a.key) acc[a.key] = a.value;
                  return acc;
                }, {} as Record<string, string | undefined>) ?? {};

                vulnerabilities.push({
                  cveId: basic.name ?? "Unknown CVE",
                  severity: mapAwsSeverity(basic.severity),
                  packageName: attr["package_name"] ?? "Unknown package",
                  installedVersion: attr["package_version"] ?? "Unknown version",
                  fixedVersion: undefined,
                  description: basic.description || "No description",
                });
              }
            }
          }

          const imageRef = `${repo.repositoryUri}:${img.imageTags?.[0] ?? "latest"}`;
          const imageName = `${repo.repositoryName}:${img.imageTags?.[0] ?? "latest"}`;

          const summary = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            negligible: 0,
          };
          for (const v of vulnerabilities) summary[v.severity]++;

          results.push({
            imageRef,
            imageName,
            cloud: "aws",
            accountId: repo.registryId,
            scannedAt: img.imageScanFindingsSummary?.imageScanCompletedAt?.toISOString() ?? new Date().toISOString(),
            vulnerabilities,
            summary,
          });
        }
      } catch (e) {
        console.warn(`[aws-ecr] Failed to fetch images for repo ${repo.repositoryName}:`, e);
      }
    }
  } catch (error) {
    const isExpected = String(error).includes("AccessDenied") || String(error).includes("credentials");
    if (isExpected) {
      console.info(`[aws-ecr] skipping ${region}: missing credentials or access denied`);
    } else {
      console.warn(`[aws-ecr] Failed to list repositories in ${region}:`, error);
    }
  }

  return results;
}
