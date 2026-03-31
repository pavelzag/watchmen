import { google } from "googleapis";
import { initGoogleAuth } from "./client";
import { ImageScanResult, ContainerVulnerability, CveSeverity } from "../container-scanning";

function mapSeverity(gcpSev: string): CveSeverity {
  switch (gcpSev?.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "negligible";
  }
}

export async function getGcpContainerVulnerabilities(projectId: string): Promise<ImageScanResult[]> {
  initGoogleAuth();
  const ca = google.containeranalysis("v1");
  
  const resultsByImage = new Map<string, ImageScanResult>();
  let pageToken: string | undefined = undefined;

  try {
    do {
      const res: any = await ca.projects.occurrences.list({
        parent: `projects/${projectId}`,
        filter: 'kind="VULNERABILITY"',
        pageSize: 1000,
        pageToken,
      });

      const occurrences = res.data.occurrences ?? [];
      
      for (const occ of occurrences) {
        if (!occ.resourceUri || !occ.vulnerability) continue;
        
        const imageRef = occ.resourceUri;
        
        if (!resultsByImage.has(imageRef)) {
          const parts = imageRef.split("/");
          const imageNameAndTag = parts[parts.length - 1] ?? imageRef;
          
          resultsByImage.set(imageRef, {
            imageRef,
            imageName: imageNameAndTag,
            cloud: "gcp",
            accountId: projectId,
            scannedAt: occ.createTime ?? new Date().toISOString(),
            vulnerabilities: [],
            summary: {
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              negligible: 0,
            }
          });
        }
        
        const result = resultsByImage.get(imageRef)!;
        const vuln = occ.vulnerability;
        
        const severity = mapSeverity(vuln.severity ?? "NEGLIGIBLE");
        const cveId = vuln.shortDescription ?? "Unknown CVE";
        const cvssScore = vuln.cvssScore ?? undefined;
        const description = (vuln.longDescription || occ.noteName || "").split("\n")[0];
        
        const pkg = vuln.packageIssue?.[0];
        const packageName = pkg?.affectedPackage ?? "Unknown package";
        const installedVersion = pkg?.affectedVersion?.name ?? "Unknown version";
        const fixedVersion = pkg?.fixedVersion?.name ?? undefined;
        
        result.vulnerabilities.push({
          cveId,
          severity,
          packageName,
          installedVersion,
          fixedVersion,
          description,
          cvssScore,
        });
        
        result.summary[severity]++;
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

  } catch (error) {
    const errStr = String(error);
    const isExpected = 
      errStr.includes("API not enabled") || 
      errStr.includes("is disabled") ||
      errStr.includes("Insufficient Permission") ||
      errStr.includes("denied") ||
      errStr.includes("403");
      
    if (isExpected) {
      console.info(`[gcp-container-analysis] skipping ${projectId}: Container Analysis API not enabled or access denied. Reason: ${errStr}`);
    } else {
      console.warn(`[gcp-container-analysis] Failed to fetch vulnerabilities for ${projectId}:`, error);
    }
  }

  return Array.from(resultsByImage.values());
}
