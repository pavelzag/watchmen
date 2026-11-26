import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { ImageScanResult } from "@/lib/container-scanning";
import { getGcpAccessToken, useMockData } from "@/lib/gcp/client";
import { getGcpContainerVulnerabilities, normalizeImageUri } from "@/lib/gcp/container-analysis";
import { resolveGcpContainerScanContext } from "@/lib/gcp/container-scan-auth";
import { getCachedContainerScans, saveCachedContainerScan } from "@/lib/container-scan-cache";
import { isTrivyAvailable, scanImageWithTrivy } from "@/lib/trivy/scanner";
import { MAX_SCAN_API_BATCH } from "@/lib/container-scanning";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (useMockData() || session.isDemoUser) {
    return NextResponse.json(
      { error: "On-demand Trivy scanning is disabled in demo/mock mode." },
      { status: 403 }
    );
  }

  const available = await isTrivyAvailable();
  if (!available) {
    return NextResponse.json(
      { error: "Trivy binary is not available in this server runtime." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    imageRefs?: unknown;
    force?: unknown;
  };
  const requestedRefs = Array.isArray(body.imageRefs)
    ? body.imageRefs.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : [];
  const force = Boolean(body.force);

  try {
    const ctx = await resolveGcpContainerScanContext({
      email: session.user.email,
      accessToken: session.accessToken,
    });

    if (!ctx.authMode || ctx.projectIds.length === 0) {
      return NextResponse.json(
        { error: "No GCP credentials or projects configured to scan." },
        { status: 422 }
      );
    }

    // Discover authorized Artifact Registry images across the user's projects
    const gcpLists = await Promise.all(
      ctx.projectIds.map((pid) => getGcpContainerVulnerabilities(pid, { skipContainerAnalysis: true }))
    );
    const allGcpImages = gcpLists.flat();
    const byNormRef = new Map<string, ImageScanResult>();
    for (const img of allGcpImages) {
      byNormRef.set(normalizeImageUri(img.imageRef), img);
    }

    // Select target images: either requested subset (validated against discovered AR images) or all unscanned
    let targets: ImageScanResult[];
    if (requestedRefs.length > 0) {
      targets = [];
      const seen = new Set<string>();
      for (const ref of requestedRefs) {
        const norm = normalizeImageUri(ref);
        if (seen.has(norm)) continue;
        seen.add(norm);
        const match = byNormRef.get(norm);
        if (match) targets.push(match);
      }
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "None of the requested images were found in your authorized GCP projects." },
          { status: 404 }
        );
      }
    } else {
      targets = allGcpImages.filter((img) => img.scanStatus === "unscanned");
    }

    targets = targets.slice(0, MAX_SCAN_API_BATCH);

    const cachedMap = force
      ? new Map()
      : await getCachedContainerScans(targets.map((t) => t.imageRef));

    const accessToken = await getGcpAccessToken();
    const scanned: ImageScanResult[] = [];
    const errors: Array<{ imageRef: string; error: string }> = [];

    for (const target of targets) {
      const norm = normalizeImageUri(target.imageRef);
      const cached = cachedMap.get(norm);
      if (cached) {
        scanned.push({
          ...target,
          vulnerabilities: cached.vulnerabilities,
          summary: cached.summary,
          scannedAt: cached.scannedAt,
          scanner: cached.scanner || "trivy",
          scanStatus: cached.vulnerabilities.length > 0 ? "scanned" : "clean",
          scanStatusMessage: undefined,
        });
        continue;
      }

      try {
        const trivyOut = await scanImageWithTrivy({
          imageRef: target.imageRef,
          accessToken,
        });

        await saveCachedContainerScan({
          imageRef: norm,
          cloud: "gcp",
          accountId: target.accountId,
          scanner: "trivy",
          vulnerabilities: trivyOut.vulnerabilities,
          summary: trivyOut.summary,
          scannedAt: trivyOut.scannedAt,
        });

        scanned.push({
          ...target,
          vulnerabilities: trivyOut.vulnerabilities,
          summary: trivyOut.summary,
          scannedAt: trivyOut.scannedAt,
          scanner: "trivy",
          scanStatus: trivyOut.vulnerabilities.length > 0 ? "scanned" : "clean",
          scanStatusMessage: undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[api/container-scan/scan] Trivy scan failed for ${target.imageRef}:`, msg);
        errors.push({
          imageRef: target.imageRef,
          error: msg.split("\n")[0] || "Trivy scan failed",
        });
      }
    }

    return NextResponse.json({
      scanned,
      errors,
    });
  } catch (err: any) {
    console.error("[api/container-scan/scan] Failed:", err);
    return NextResponse.json(
      { error: "Failed to run container image scan. See server logs for details." },
      { status: 500 }
    );
  }
}
