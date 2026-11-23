import { ensureContainerScanCacheTable, sql } from "./db";
import type { ContainerVulnerability, ImageScanResult } from "./container-scanning";
import { normalizeImageUri } from "./gcp/container-analysis";

export interface CachedContainerScan {
  imageRef: string;
  cloud: string;
  accountId: string;
  scanner: string;
  vulnerabilities: ContainerVulnerability[];
  summary: ImageScanResult["summary"];
  scannedAt: string;
}

function isDbConfigured(): boolean {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

export async function getCachedContainerScans(
  imageRefs: string[]
): Promise<Map<string, CachedContainerScan>> {
  const result = new Map<string, CachedContainerScan>();
  if (!isDbConfigured() || imageRefs.length === 0) {
    return result;
  }

  const normalized = Array.from(new Set(imageRefs.map(normalizeImageUri).filter(Boolean)));
  if (normalized.length === 0) return result;

  try {
    await ensureContainerScanCacheTable();
    const res = await sql<{
      image_ref: string;
      cloud: string;
      account_id: string;
      scanner: string;
      vulnerabilities: ContainerVulnerability[];
      summary: ImageScanResult["summary"];
      scanned_at: Date | string;
    }>`
      SELECT image_ref, cloud, account_id, scanner, vulnerabilities, summary, scanned_at
      FROM container_scan_cache
      WHERE image_ref IN (SELECT jsonb_array_elements_text(${JSON.stringify(normalized)}::jsonb))
    `;

    for (const row of res.rows) {
      const vulns = Array.isArray(row.vulnerabilities) ? row.vulnerabilities : [];
      const summary = row.summary ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        negligible: 0,
      };
      const scannedAt =
        row.scanned_at instanceof Date
          ? row.scanned_at.toISOString()
          : String(row.scanned_at);

      result.set(normalizeImageUri(row.image_ref), {
        imageRef: row.image_ref,
        cloud: row.cloud,
        accountId: row.account_id,
        scanner: row.scanner || "trivy",
        vulnerabilities: vulns,
        summary,
        scannedAt,
      });
    }
  } catch (err) {
    console.warn("[container-scan-cache] Failed to read cache:", err);
  }

  return result;
}

export async function saveCachedContainerScan(record: CachedContainerScan): Promise<void> {
  if (!isDbConfigured()) return;

  const normRef = normalizeImageUri(record.imageRef);
  try {
    await ensureContainerScanCacheTable();
    await sql`
      INSERT INTO container_scan_cache (
        image_ref,
        cloud,
        account_id,
        scanner,
        vulnerabilities,
        summary,
        scanned_at
      )
      VALUES (
        ${normRef},
        ${record.cloud},
        ${record.accountId},
        ${record.scanner},
        ${JSON.stringify(record.vulnerabilities)}::jsonb,
        ${JSON.stringify(record.summary)}::jsonb,
        ${record.scannedAt}
      )
      ON CONFLICT (image_ref) DO UPDATE
        SET cloud = EXCLUDED.cloud,
            account_id = EXCLUDED.account_id,
            scanner = EXCLUDED.scanner,
            vulnerabilities = EXCLUDED.vulnerabilities,
            summary = EXCLUDED.summary,
            scanned_at = EXCLUDED.scanned_at
    `;
  } catch (err) {
    console.warn("[container-scan-cache] Failed to save scan cache:", err);
  }
}

export async function mergeCachedTrivyScans(results: ImageScanResult[]): Promise<ImageScanResult[]> {
  const unscannedRefs = results
    .filter((r) => r.cloud === "gcp" && r.scanStatus === "unscanned")
    .map((r) => r.imageRef);

  if (unscannedRefs.length === 0) return results;

  const cachedMap = await getCachedContainerScans(unscannedRefs);
  if (cachedMap.size === 0) return results;

  return results.map((r) => {
    if (r.cloud !== "gcp" || r.scanStatus !== "unscanned") return r;
    const cached = cachedMap.get(normalizeImageUri(r.imageRef));
    if (!cached) return r;

    return {
      ...r,
      vulnerabilities: cached.vulnerabilities,
      summary: cached.summary,
      scannedAt: cached.scannedAt,
      scanner: cached.scanner || "trivy",
      scanStatus: cached.vulnerabilities.length > 0 ? "scanned" : "clean",
      scanStatusMessage: undefined,
    };
  });
}
