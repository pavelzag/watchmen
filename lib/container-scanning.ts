/**
 * Container image vulnerability scanning types and mock data.
 * Real data is sourced from GCP Container Analysis API and AWS ECR Enhanced Scanning.
 */

export type CveSeverity = "critical" | "high" | "medium" | "low" | "negligible";

export interface ContainerVulnerability {
  /** CVE or vulnerability ID */
  cveId: string;
  severity: CveSeverity;
  /** Affected package name */
  packageName: string;
  /** Installed version */
  installedVersion: string;
  /** Fixed version (if available) */
  fixedVersion?: string;
  description: string;
  cvssScore?: number;
}

export type ImageRegistry = "gcp" | "aws" | "ghcr" | "dockerhub";

export interface ImageScanResult {
  /** Full image reference, e.g. us-docker.pkg.dev/my-project/repo/image:tag */
  imageRef: string;
  /** Short display name */
  imageName: string;
  cloud: ImageRegistry;
  /** Project ID, AWS account ID, GitHub org, or Docker Hub namespace */
  accountId: string;
  scannedAt: string;
  vulnerabilities: ContainerVulnerability[];
  /** Total counts by severity */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    negligible: number;
  };
}

// ─── Mock data ────────────────────────────────────────────────────────────────

export function getMockScanResults(): ImageScanResult[] {
  return [
    {
      imageRef: "us-docker.pkg.dev/infra_core/services/api-gateway:prod-1.8.2",
      imageName: "api-gateway:prod-1.8.2",
      cloud: "gcp",
      accountId: "infra_core",
      scannedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      vulnerabilities: [
        {
          cveId: "CVE-2024-3094",
          severity: "critical",
          packageName: "xz-utils",
          installedVersion: "5.6.0",
          fixedVersion: "5.6.1",
          description: "Supply chain backdoor in xz/liblzma that could allow remote code execution.",
          cvssScore: 10.0,
        },
        {
          cveId: "CVE-2023-44487",
          severity: "high",
          packageName: "golang.org/x/net",
          installedVersion: "0.10.0",
          fixedVersion: "0.17.0",
          description: "HTTP/2 Rapid Reset vulnerability enabling DDoS attacks.",
          cvssScore: 7.5,
        },
        {
          cveId: "CVE-2023-39325",
          severity: "high",
          packageName: "golang.org/x/net",
          installedVersion: "0.10.0",
          fixedVersion: "0.17.0",
          description: "HTTP/2 rapid stream reset allows excessive server resource consumption.",
          cvssScore: 7.5,
        },
        {
          cveId: "CVE-2024-21626",
          severity: "high",
          packageName: "runc",
          installedVersion: "1.1.9",
          fixedVersion: "1.1.12",
          description: "Container escape vulnerability in runc via file descriptor leak.",
          cvssScore: 8.6,
        },
        {
          cveId: "CVE-2023-47038",
          severity: "medium",
          packageName: "perl",
          installedVersion: "5.36.0",
          fixedVersion: "5.36.3",
          description: "Write past buffer end via crafted regular expression.",
          cvssScore: 5.5,
        },
        {
          cveId: "CVE-2023-5678",
          severity: "medium",
          packageName: "openssl",
          installedVersion: "3.0.10",
          fixedVersion: "3.0.12",
          description: "Denial of service via excessive time spent in DH key generation.",
          cvssScore: 5.3,
        },
      ],
      summary: { critical: 1, high: 3, medium: 2, low: 0, negligible: 0 },
    },
    {
      imageRef: "us-docker.pkg.dev/ml_platform/inference/ml-inference:v2.1.0",
      imageName: "ml-inference:v2.1.0",
      cloud: "gcp",
      accountId: "ml_platform",
      scannedAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
      vulnerabilities: [
        {
          cveId: "CVE-2023-6246",
          severity: "high",
          packageName: "glibc",
          installedVersion: "2.35",
          fixedVersion: "2.35-3",
          description: "Heap-based buffer overflow in __vsyslog_internal allows local privilege escalation.",
          cvssScore: 8.4,
        },
        {
          cveId: "CVE-2022-48174",
          severity: "critical",
          packageName: "busybox",
          installedVersion: "1.35.0",
          fixedVersion: "1.36.1",
          description: "Stack overflow vulnerability in ash shell leading to arbitrary code execution.",
          cvssScore: 9.8,
        },
        {
          cveId: "CVE-2023-45853",
          severity: "medium",
          packageName: "zlib",
          installedVersion: "1.2.13",
          fixedVersion: "1.3",
          description: "Integer overflow may cause out-of-bounds write in MiniZip.",
          cvssScore: 5.3,
        },
      ],
      summary: { critical: 1, high: 1, medium: 1, low: 0, negligible: 0 },
    },
    {
      imageRef: "111111111111.dkr.ecr.us-east-1.amazonaws.com/prod-api-authorizer:latest",
      imageName: "prod-api-authorizer:latest",
      cloud: "aws",
      accountId: "111111111111",
      scannedAt: new Date(Date.now() - 1 * 3600_000).toISOString(),
      vulnerabilities: [
        {
          cveId: "CVE-2024-24790",
          severity: "critical",
          packageName: "stdlib",
          installedVersion: "go1.21.0",
          fixedVersion: "go1.21.11",
          description: "Inconsistent IPv6 address parsing may bypass access controls.",
          cvssScore: 9.8,
        },
        {
          cveId: "CVE-2023-29406",
          severity: "medium",
          packageName: "net/http",
          installedVersion: "go1.21.0",
          fixedVersion: "go1.21.1",
          description: "HTTP/1.1 request smuggling via invalid Transfer-Encoding headers.",
          cvssScore: 6.5,
        },
        {
          cveId: "CVE-2023-44487",
          severity: "high",
          packageName: "golang.org/x/net",
          installedVersion: "0.13.0",
          fixedVersion: "0.17.0",
          description: "HTTP/2 Rapid Reset Attack enables DDoS at scale.",
          cvssScore: 7.5,
        },
      ],
      summary: { critical: 1, high: 1, medium: 1, low: 0, negligible: 0 },
    },
    {
      imageRef: "222222222222.dkr.ecr.eu-west-1.amazonaws.com/staging-data-sync:v0.9.1",
      imageName: "staging-data-sync:v0.9.1",
      cloud: "aws",
      accountId: "222222222222",
      scannedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
      vulnerabilities: [
        {
          cveId: "CVE-2023-32731",
          severity: "high",
          packageName: "grpc",
          installedVersion: "1.56.0",
          fixedVersion: "1.56.2",
          description: "Reachable assertion can cause server crash via specially crafted gRPC requests.",
          cvssScore: 7.5,
        },
        {
          cveId: "CVE-2023-4016",
          severity: "low",
          packageName: "procps",
          installedVersion: "3.3.17",
          fixedVersion: "4.0.3",
          description: "Buffer overflow in ps command when reading process status file.",
          cvssScore: 3.3,
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 1, negligible: 0 },
    },
  ];
}
