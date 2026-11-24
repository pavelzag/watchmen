import { getMockScanResults } from "@/lib/container-scanning";
import {
  buildAdvisoryShieldMap,
  enrichContainerResultsWithShields,
  getMockShirudoOverview,
  type ShirudoOverview,
} from "@/lib/shirudo/exposure";

describe("lib/shirudo/exposure", () => {
  it("marks CVEs covered by active healthy Shirudo nodes as shielded and totals hit counts", () => {
    const overview = getMockShirudoOverview();
    const shieldMap = buildAdvisoryShieldMap(overview);

    expect(shieldMap.get("CVE-2024-3094")).toEqual({
      status: "shielded",
      upatchId: "xz-lzma-guard",
      shieldKind: "bpf_upatch",
      activeNodes: 2,
      hitCount: 2,
      quotePresent: true,
    });

    const enriched = enrichContainerResultsWithShields(getMockScanResults(), overview);
    const xzVuln = enriched[0].vulnerabilities.find((v) => v.cveId === "CVE-2024-3094");
    expect(xzVuln?.shieldStatus?.status).toBe("shielded");
    expect(xzVuln?.shieldStatus?.upatchId).toBe("xz-lzma-guard");
  });

  it("distinguishes shield_pending and tampered states when no healthy node runs the shield", () => {
    const overview: ShirudoOverview = {
      nodes: [
        {
          nodeKey: "node-tampered",
          hostName: "edge-01",
          akName: null,
          quotePresent: false,
          verdict: "tampered",
          cond: 0,
          conditions: [],
          flags: 0,
          tamperTotal: 3,
          integrityTotal: 0,
          kernelRelease: "7.4.0-bpf-next+",
          imageId: null,
          imageVersion: null,
          imageRoot: null,
          treeId: null,
          lastSeq: null,
          loadedCount: 1,
          setSha256: null,
          loadedUpatches: ["java4shell-guard"],
          lastSeenAt: new Date().toISOString(),
        },
      ],
      fixes: [
        {
          upatchId: "java4shell-guard",
          advisoryId: "CVE-2026-4444",
          treeId: "fleet",
          shieldKind: "java_agent",
          source: "manual",
          updatedAt: new Date().toISOString(),
        },
        {
          upatchId: "openssl-guard",
          advisoryId: "CVE-2026-9999",
          treeId: "fleet",
          shieldKind: "bpf_upatch",
          source: "manual",
          updatedAt: new Date().toISOString(),
        },
      ],
      recentHits: [],
      summary: {
        totalNodes: 1,
        healthyNodes: 0,
        tamperedNodes: 1,
        quotedNodes: 0,
        shieldedAdvisories: 0,
        totalBlockedHits: 0,
      },
    };

    const map = buildAdvisoryShieldMap(overview);
    expect(map.get("CVE-2026-4444")?.status).toBe("tampered");
    expect(map.get("CVE-2026-9999")?.status).toBe("shield_pending");
  });
});
