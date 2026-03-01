import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { sql } from "@/lib/db";
import { runSoc2 } from "@/lib/compliance/soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import type { ComplianceReport } from "@/lib/compliance/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const standard = req.nextUrl.searchParams.get("standard") ?? "soc2";
  const userEmail = session.user.email;
  const isMock = useMockData();

  try {
    let snapshot;

    if (isMock) {
      snapshot = await fetchGcpSnapshot();
    } else {
      const result = await sql`
        SELECT snapshot FROM user_snapshots WHERE user_email = ${userEmail}
      `;
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: "No snapshot yet. Please wait for the initial scan." },
          { status: 404 }
        );
      }
      snapshot = result.rows[0].snapshot;
    }

    const report: ComplianceReport = standard === "iso27001" ? runIso27001(snapshot) : runSoc2(snapshot);

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
              if (control.status !== "pass" && suppressMap.has(control.id)) {
                control.status = "suppressed";
                control.justification = suppressMap.get(control.id);
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
