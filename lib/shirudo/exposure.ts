import type { ImageScanResult, VulnerabilityShieldStatus } from "@/lib/container-scanning";
import { decodeCondBits, type ShirudoDecodedCondition } from "@/lib/shirudo/otlp";

export interface ShirudoNodeRecord {
  nodeKey: string;
  hostName: string;
  akName: string | null;
  quotePresent: boolean;
  quoteVerified?: boolean;
  tpmResetCount?: number | null;
  tpmClock?: string | null;
  historyContradiction?: boolean;
  quoteVerificationError?: string | null;
  verdict: string;
  cond: number;
  conditions: ShirudoDecodedCondition[];
  flags: number;
  tamperTotal: number;
  integrityTotal: number;
  kernelRelease: string;
  imageId: string | null;
  imageVersion: string | null;
  imageRoot: string | null;
  treeId: string | null;
  lastSeq: number | null;
  loadedCount: number;
  setSha256: string | null;
  loadedUpatches: string[];
  lastSeenAt: string;
}

export interface ShirudoUpatchFixRecord {
  upatchId: string;
  advisoryId: string;
  treeId: string;
  shieldKind: "bpf_upatch" | "java_agent";
  source: string;
  updatedAt: string;
}

export interface ShirudoShieldHitRecord {
  id: number;
  nodeKey: string;
  hostName: string;
  upatchId: string;
  mapName: string;
  advisoryId: string | null;
  hitCount: number;
  observedAt: string;
}

export interface ShirudoOverview {
  nodes: ShirudoNodeRecord[];
  fixes: ShirudoUpatchFixRecord[];
  recentHits: ShirudoShieldHitRecord[];
  summary: {
    totalNodes: number;
    healthyNodes: number;
    tamperedNodes: number;
    quotedNodes: number;
    verifiedNodes?: number;
    contradictionNodes?: number;
    shieldedAdvisories: number;
    totalBlockedHits: number;
  };
}

export function buildAdvisoryShieldMap(overview: ShirudoOverview): Map<string, VulnerabilityShieldStatus> {
  const hitsByUpatch = new Map<string, number>();
  const hitsByAdvisory = new Map<string, number>();
  for (const hit of overview.recentHits) {
    hitsByUpatch.set(hit.upatchId, (hitsByUpatch.get(hit.upatchId) ?? 0) + hit.hitCount);
    if (hit.advisoryId) {
      const key = hit.advisoryId.toUpperCase();
      hitsByAdvisory.set(key, (hitsByAdvisory.get(key) ?? 0) + hit.hitCount);
    }
  }

  const healthyNodes = overview.nodes.filter((n) => n.verdict === "ok" || n.verdict === "degraded");
  const tamperedNodes = overview.nodes.filter((n) => n.verdict === "tampered" || n.verdict === "lsm-off");
  const hasQuotedHealthyNode = healthyNodes.some((n) => n.quotePresent);

  const map = new Map<string, VulnerabilityShieldStatus>();

  for (const fix of overview.fixes) {
    const advisoryKey = fix.advisoryId.trim().toUpperCase();
    if (!advisoryKey) continue;

    // Nodes explicitly reporting this upatch, or healthy nodes with loadedCount > 0 when upatch list isn't itemized.
    const matchingHealthy = healthyNodes.filter(
      (n) => n.loadedUpatches.includes(fix.upatchId) || (n.loadedUpatches.length === 0 && n.loadedCount > 0)
    );
    const matchingTampered = tamperedNodes.filter(
      (n) => n.loadedUpatches.includes(fix.upatchId) || (n.loadedUpatches.length === 0 && n.loadedCount > 0)
    );

    const status: VulnerabilityShieldStatus["status"] =
      matchingHealthy.length > 0
        ? "shielded"
        : matchingTampered.length > 0
          ? "tampered"
          : "shield_pending";

    const hitCount = Math.max(
      hitsByAdvisory.get(advisoryKey) ?? 0,
      hitsByUpatch.get(fix.upatchId) ?? 0
    );

    const existing = map.get(advisoryKey);
    if (
      !existing ||
      (existing.status !== "shielded" && status === "shielded") ||
      matchingHealthy.length > existing.activeNodes
    ) {
      map.set(advisoryKey, {
        status,
        upatchId: fix.upatchId,
        shieldKind: fix.shieldKind,
        activeNodes: matchingHealthy.length,
        hitCount,
        quotePresent: matchingHealthy.some((n) => n.quotePresent) || hasQuotedHealthyNode,
      });
    }
  }

  return map;
}

export function enrichContainerResultsWithShields(
  results: ImageScanResult[],
  overview: ShirudoOverview
): ImageScanResult[] {
  if (overview.fixes.length === 0) return results;
  const shieldMap = buildAdvisoryShieldMap(overview);
  if (shieldMap.size === 0) return results;

  return results.map((result) => ({
    ...result,
    vulnerabilities: result.vulnerabilities.map((vuln) => {
      const shieldStatus = shieldMap.get(vuln.cveId.trim().toUpperCase());
      return shieldStatus ? { ...vuln, shieldStatus } : vuln;
    }),
  }));
}

export function getMockShirudoOverview(): ShirudoOverview {
  const now = Date.now();
  const nodes: ShirudoNodeRecord[] = [
    {
      nodeKey: "000b9f4e71a2c8d3e4f50112233445566778899aabbccddeeff00112233445566778",
      hostName: "prod-api-shield-01",
      akName: "000b9f4e71a2c8d3e4f50112233445566778899aabbccddeeff00112233445566778",
      quotePresent: true,
      quoteVerified: true,
      tpmResetCount: 4,
      tpmClock: "184200",
      historyContradiction: false,
      quoteVerificationError: null,
      verdict: "ok",
      cond: 5461,
      conditions: decodeCondBits(5461),
      flags: 0,
      tamperTotal: 0,
      integrityTotal: 0,
      kernelRelease: "7.4.0-bpf-next+shirudo",
      imageId: "watchmen-hardened-os",
      imageVersion: "2026.11.24",
      imageRoot: "6d5ed552f448a1c07e3b9d24f5a86c1e0b7d93f2c4e5a6b7180c9d2e3f4a5b6c",
      treeId: "fleet-prod",
      lastSeq: 12,
      loadedCount: 2,
      setSha256: "5f0c2e8b7a1d4c3f9e6b2a0d8c7f1e3b5a9d4c2e6f8b0a1d3c5e7f9b2d4a6c8e",
      loadedUpatches: ["xz-lzma-guard", "http2-rst-limit"],
      lastSeenAt: new Date(now - 25_000).toISOString(),
    },
    {
      nodeKey: "000b3c8d11e2f4a5b6c7d8e9f0112233445566778899aabbccddeeff001122334455",
      hostName: "prod-worker-shield-02",
      akName: "000b3c8d11e2f4a5b6c7d8e9f0112233445566778899aabbccddeeff001122334455",
      quotePresent: true,
      quoteVerified: true,
      tpmResetCount: 2,
      tpmClock: "91400",
      historyContradiction: false,
      quoteVerificationError: null,
      verdict: "ok",
      cond: 5461,
      conditions: decodeCondBits(5461),
      flags: 0,
      tamperTotal: 0,
      integrityTotal: 0,
      kernelRelease: "7.4.0-bpf-next+shirudo",
      imageId: "watchmen-hardened-os",
      imageVersion: "2026.11.24",
      imageRoot: "6d5ed552f448a1c07e3b9d24f5a86c1e0b7d93f2c4e5a6b7180c9d2e3f4a5b6c",
      treeId: "fleet-prod",
      lastSeq: 12,
      loadedCount: 2,
      setSha256: "5f0c2e8b7a1d4c3f9e6b2a0d8c7f1e3b5a9d4c2e6f8b0a1d3c5e7f9b2d4a6c8e",
      loadedUpatches: ["xz-lzma-guard", "http2-rst-limit"],
      lastSeenAt: new Date(now - 42_000).toISOString(),
    },
  ];

  const fixes: ShirudoUpatchFixRecord[] = [
    {
      upatchId: "xz-lzma-guard",
      advisoryId: "CVE-2024-3094",
      treeId: "fleet-prod",
      shieldKind: "bpf_upatch",
      source: "tree",
      updatedAt: new Date(now - 3600_000).toISOString(),
    },
    {
      upatchId: "http2-rst-limit",
      advisoryId: "CVE-2023-44487",
      treeId: "fleet-prod",
      shieldKind: "bpf_upatch",
      source: "tree",
      updatedAt: new Date(now - 7200_000).toISOString(),
    },
  ];

  const recentHits: ShirudoShieldHitRecord[] = [
    {
      id: 1,
      nodeKey: nodes[0].nodeKey,
      hostName: "prod-api-shield-01",
      upatchId: "http2-rst-limit",
      mapName: "rst_blocked",
      advisoryId: "CVE-2023-44487",
      hitCount: 14,
      observedAt: new Date(now - 120_000).toISOString(),
    },
    {
      id: 2,
      nodeKey: nodes[1].nodeKey,
      hostName: "prod-worker-shield-02",
      upatchId: "xz-lzma-guard",
      mapName: "sshd_hook_guard",
      advisoryId: "CVE-2024-3094",
      hitCount: 2,
      observedAt: new Date(now - 300_000).toISOString(),
    },
  ];

  return {
    nodes,
    fixes,
    recentHits,
    summary: {
      totalNodes: nodes.length,
      healthyNodes: 2,
      tamperedNodes: 0,
      quotedNodes: 2,
      verifiedNodes: 2,
      contradictionNodes: 0,
      shieldedAdvisories: 2,
      totalBlockedHits: 16,
    },
  };
}
