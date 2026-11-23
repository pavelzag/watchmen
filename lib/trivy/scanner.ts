import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ContainerVulnerability, CveSeverity, ImageScanResult } from "../container-scanning";

const execFileAsync = promisify(execFile);

export interface TrivyScanOutput {
  vulnerabilities: ContainerVulnerability[];
  summary: ImageScanResult["summary"];
  scannedAt: string;
}

interface TrivyJsonVulnerability {
  VulnerabilityID?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Severity?: string;
  Title?: string;
  Description?: string;
  CVSS?: Record<string, { V3Score?: number; V2Score?: number }>;
}

interface TrivyJsonReport {
  Results?: Array<{
    Target?: string;
    Class?: string;
    Type?: string;
    Vulnerabilities?: TrivyJsonVulnerability[] | null;
  }>;
}

function getTrivyBin(): string {
  return process.env.TRIVY_BIN?.trim() || "trivy";
}

function getTrivyCacheDir(): string {
  return process.env.TRIVY_CACHE_DIR?.trim() || "/tmp/trivy-cache";
}

export function isValidImageRef(imageRef: string): boolean {
  const trimmed = imageRef.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (trimmed.startsWith("-")) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]+$/.test(trimmed);
}

function mapTrivySeverity(sev?: string): CveSeverity {
  switch (sev?.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "negligible";
  }
}

function extractCvssScore(cvss?: Record<string, { V3Score?: number; V2Score?: number }>): number | undefined {
  if (!cvss) return undefined;
  const preferredOrder = ["nvd", "redhat", "ghsa", "ubuntu", "debian", "alpine"];
  for (const key of preferredOrder) {
    const entry = cvss[key];
    if (typeof entry?.V3Score === "number") return entry.V3Score;
    if (typeof entry?.V2Score === "number") return entry.V2Score;
  }
  for (const entry of Object.values(cvss)) {
    if (typeof entry?.V3Score === "number") return entry.V3Score;
    if (typeof entry?.V2Score === "number") return entry.V2Score;
  }
  return undefined;
}

export function parseTrivyReport(rawJson: string): {
  vulnerabilities: ContainerVulnerability[];
  summary: ImageScanResult["summary"];
} {
  const parsed = JSON.parse(rawJson || "{}") as TrivyJsonReport;
  const vulnerabilities: ContainerVulnerability[] = [];
  const seen = new Set<string>();
  const summary: ImageScanResult["summary"] = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    negligible: 0,
  };

  for (const result of parsed.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const cveId = v.VulnerabilityID?.trim() || "Unknown CVE";
      const packageName = v.PkgName?.trim() || "Unknown package";
      const installedVersion = v.InstalledVersion?.trim() || "Unknown version";
      const dedupeKey = `${cveId}::${packageName}::${installedVersion}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const severity = mapTrivySeverity(v.Severity);
      const description = (v.Title || v.Description || "").split("\n")[0].trim();

      vulnerabilities.push({
        cveId,
        severity,
        packageName,
        installedVersion,
        fixedVersion: v.FixedVersion?.trim() || undefined,
        description,
        cvssScore: extractCvssScore(v.CVSS),
      });
      summary[severity]++;
    }
  }

  return { vulnerabilities, summary };
}

export async function isTrivyAvailable(): Promise<boolean> {
  try {
    await execFileAsync(getTrivyBin(), ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function scanImageWithTrivy(options: {
  imageRef: string;
  accessToken?: string | null;
}): Promise<TrivyScanOutput> {
  const imageRef = options.imageRef.trim().replace(/^https?:\/\//i, "");
  if (!isValidImageRef(imageRef)) {
    throw new Error(`Invalid container image reference: ${options.imageRef}`);
  }

  const bin = getTrivyBin();
  const cacheDir = getTrivyCacheDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TRIVY_CACHE_DIR: cacheDir,
    ...(options.accessToken
      ? {
          TRIVY_USERNAME: "oauth2accesstoken",
          TRIVY_PASSWORD: options.accessToken,
        }
      : {}),
  };

  const baseArgs = [
    "image",
    "--format",
    "json",
    "--scanners",
    "vuln",
    "--quiet",
    "--no-progress",
    "--timeout",
    "120s",
  ];

  const runScan = async (extraArgs: string[] = []): Promise<string> => {
    const { stdout } = await execFileAsync(bin, [...baseArgs, ...extraArgs, imageRef], {
      env,
      maxBuffer: 25 * 1024 * 1024,
      timeout: 130_000,
    });
    return stdout;
  };

  let stdout: string;
  try {
    stdout = await runScan();
  } catch (err) {
    // If DB update failed (e.g. GHCR rate limit/transient network) and a pre-warmed DB exists, retry offline
    const hasLocalDb = existsSync(path.join(cacheDir, "db", "trivy.db"));
    const msg = err instanceof Error ? err.message : String(err);
    if (hasLocalDb && /db|download|ghcr\.io/i.test(msg)) {
      stdout = await runScan(["--skip-db-update"]);
    } else {
      throw err;
    }
  }

  const { vulnerabilities, summary } = parseTrivyReport(stdout);
  return {
    vulnerabilities,
    summary,
    scannedAt: new Date().toISOString(),
  };
}
