import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { fetchAwsSnapshot } from "@/lib/aws"; // Added AWS
import { useMockAwsData } from "@/lib/aws/client"; // Added AWS
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable, ensureComplianceTables } from "@/lib/db";
import { runSoc2 } from "@/lib/compliance/soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2"; // Added AWS
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001"; // Added AWS
import type { ComplianceCategory, ComplianceReport } from "@/lib/compliance/types";

function namespaceCategories(categories: ComplianceCategory[], cloud: "gcp" | "aws"): ComplianceCategory[] {
  const cloudLabel = cloud.toUpperCase();
  return categories.map((category) => ({
    ...category,
    id: `${cloud}:${category.id}`,
    name: `${cloudLabel} ${category.name}`,
    controls: category.controls.map((control) => ({
      ...control,
      id: `${cloud}:${control.id}`,
    })),
  }));
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const standard = req.nextUrl.searchParams.get("standard") ?? "soc2";
  const userEmail = session.user.email;
  const isMock = useMockData();
  const isAwsMock = useMockAwsData();

  try {
    let gcpSnapshot;
    let awsSnapshot;

    if (isMock || session.isDemoUser) {
      gcpSnapshot = await fetchGcpSnapshot({ forceMock: true });
    } else {
      await ensureGcpSnapshotTable();
      const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${userEmail}`;
      if (result.rows.length > 0) gcpSnapshot = result.rows[0].snapshot;
    }

    if (isAwsMock || session.isDemoUser) {
      awsSnapshot = await fetchAwsSnapshot({ forceMock: true });
    } else {
      await ensureAwsSnapshotTable();
      const result = await sql`SELECT snapshot FROM aws_snapshots WHERE user_email = ${userEmail}`;
      if (result.rows.length > 0) awsSnapshot = result.rows[0].snapshot;
    }

    let report: ComplianceReport;
    const gcpReport = gcpSnapshot
      ? (standard === "iso27001" ? runIso27001(gcpSnapshot) : runSoc2(gcpSnapshot))
      : null;
    const awsReport = awsSnapshot
      ? (standard === "iso27001" ? runAwsIso27001(awsSnapshot) : runAwsSoc2(awsSnapshot))
      : null;

    if (!gcpReport && !awsReport) {
      return NextResponse.json({ error: "No snapshots yet." }, { status: 404 });
    }

    const reports = [gcpReport, awsReport].filter(Boolean) as ComplianceReport[];
    const categories = [
      ...(gcpReport ? namespaceCategories(gcpReport.categories, "gcp") : []),
      ...(awsReport ? namespaceCategories(awsReport.categories, "aws") : []),
    ];

    report = {
      standard: reports.map((r) => r.standard).join(" & "),
      generatedAt: new Date().toISOString(),
      totalControls: reports.reduce((s, r) => s + r.totalControls, 0),
      passingControls: reports.reduce((s, r) => s + r.passingControls, 0),
      failingControls: reports.reduce((s, r) => s + r.failingControls, 0),
      warningControls: reports.reduce((s, r) => s + r.warningControls, 0),
      suppressedControls: reports.reduce((s, r) => s + r.suppressedControls, 0),
      score: 0, // Recalculated below
      categories,
    };

    // Recalculate score
    report.score = report.totalControls === 0 ? 100 : Math.round(
      ((report.passingControls + report.suppressedControls + report.warningControls * 0.5) / report.totalControls) * 100
    );

    // Apply suppressions (skip in mock mode)
    if (!isMock) {
      try {
        const suppressions = await sql`
          SELECT control_id, justification FROM compliance_suppressions
          WHERE user_email = ${userEmail}
        `;
        if (suppressions.rows.length > 0) {
          const suppressMap = new Map<string, string>(
            suppressions.rows.map((r) => [r.control_id as string, r.justification as string])
          );
          for (const category of report.categories) {
            for (const control of category.controls) {
              const legacyControlId = control.id.replace(/^(gcp|aws):/, "");
              const suppressionId = suppressMap.has(control.id)
                ? control.id
                : control.id.startsWith("gcp:") && suppressMap.has(legacyControlId)
                  ? legacyControlId
                  : null;
              if (control.status !== "pass" && suppressionId) {
                control.status = "suppressed";
                control.justification = suppressMap.get(suppressionId);
              }
            }
          }
          // Recompute counts with suppressions applied
          const allControls = report.categories.flatMap((c) => c.controls);
          report.passingControls = allControls.filter((c) => c.status === "pass").length;
          report.failingControls = allControls.filter((c) => c.status === "fail").length;
          report.warningControls = allControls.filter((c) => c.status === "warning").length;
          report.suppressedControls = allControls.filter((c) => c.status === "suppressed").length;
          report.score =
            report.totalControls === 0
              ? 100
              : Math.round(
                ((report.passingControls + report.suppressedControls + report.warningControls * 0.5) /
                  report.totalControls) *
                100
              );
        }
      } catch (err) {
        console.warn("[api/compliance] could not load suppressions:", err);
      }

      // Write compliance history (skip if last record for same standard has same score within 1h)
      try {
        const last = await sql`
          SELECT score, recorded_at FROM compliance_history
          WHERE user_email = ${userEmail} AND standard = ${standard}
          ORDER BY recorded_at DESC
          LIMIT 1
        `;
        const shouldWrite =
          last.rows.length === 0 ||
          last.rows[0].score !== report.score ||
          new Date().getTime() - new Date(last.rows[0].recorded_at as string).getTime() > 60 * 60 * 1000;

        if (shouldWrite) {
          await sql`
            INSERT INTO compliance_history (user_email, standard, score, total_controls, failing_controls, warning_controls)
            VALUES (${userEmail}, ${standard}, ${report.score}, ${report.totalControls}, ${report.failingControls}, ${report.warningControls})
          `;
        }
      } catch (err) {
        console.warn("[api/compliance] could not write history:", err);
      }
    }

    return NextResponse.json(report);
  } catch (err) {
    console.error("[api/compliance] error:", err);
    return NextResponse.json({ error: "Failed to generate compliance report." }, { status: 500 });
  }
}
