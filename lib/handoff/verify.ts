import { resolveAI } from "@/lib/ai/client";
import { completeAgentRun, createAgentRun } from "@/lib/agent/store";
import { verifyFix } from "@/lib/agent/verify-fix";
import { computeAwsFindings } from "@/lib/aws-findings";
import type { AwsSnapshot } from "@/lib/aws/types";
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runSoc2 } from "@/lib/compliance/soc2";
import { ensureAwsSnapshotTable, ensureGcpSnapshotTable, sql } from "@/lib/db";
import { computeFindings } from "@/lib/findings";
import { computeAttackPaths } from "@/lib/gcp/attack-paths";
import type { GcpSnapshot } from "@/lib/gcp/types";
import { getHandoffTask, saveHandoffTaskVerification } from "@/lib/handoff/store";
import {
  issueToRemediationTarget,
  type HandoffTaskRecord,
  type LastVerificationSummary,
} from "@/lib/handoff/tasks";
import { extractAdvisoryIds } from "@/lib/handoff/shirudo";
import { buildAdvisoryShieldMap } from "@/lib/shirudo/exposure";
import { getShirudoOverview } from "@/lib/shirudo/store";

async function loadLatestStoredIds(userEmail: string): Promise<{
  hasGcpSnapshot: boolean;
  hasAwsSnapshot: boolean;
  gcpFetchedAt: string | null;
  awsFetchedAt: string | null;
  activeIds: Set<string>;
}> {
  const activeIds = new Set<string>();
  let hasGcpSnapshot = false;
  let hasAwsSnapshot = false;
  let gcpFetchedAt: string | null = null;
  let awsFetchedAt: string | null = null;

  await ensureGcpSnapshotTable();
  const gcpRes = await sql`
    SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${userEmail} LIMIT 1
  `;
  if (gcpRes.rows[0]?.snapshot) {
    hasGcpSnapshot = true;
    gcpFetchedAt = gcpRes.rows[0].fetched_at ? new Date(String(gcpRes.rows[0].fetched_at)).toISOString() : null;
    const gcpSnapshot = gcpRes.rows[0].snapshot as GcpSnapshot;
    for (const f of computeFindings(gcpSnapshot)) {
      activeIds.add(f.id);
    }
    for (const ap of computeAttackPaths(gcpSnapshot)) {
      activeIds.add(ap.id);
    }
    for (const report of [runSoc2(gcpSnapshot), runIso27001(gcpSnapshot)]) {
      for (const category of report.categories) {
        for (const control of category.controls) {
          if (control.status === "fail" || control.status === "warning") {
            activeIds.add(control.id);
            activeIds.add(`gcp:${control.id}`);
          }
        }
      }
    }
  }

  await ensureAwsSnapshotTable();
  const awsRes = await sql`
    SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${userEmail} LIMIT 1
  `;
  if (awsRes.rows[0]?.snapshot) {
    hasAwsSnapshot = true;
    awsFetchedAt = awsRes.rows[0].fetched_at ? new Date(String(awsRes.rows[0].fetched_at)).toISOString() : null;
    const awsSnapshot = awsRes.rows[0].snapshot as AwsSnapshot;
    for (const f of computeAwsFindings(awsSnapshot)) {
      activeIds.add(`aws:${f.id}`);
    }
    for (const report of [runAwsSoc2(awsSnapshot), runAwsIso27001(awsSnapshot)]) {
      for (const category of report.categories) {
        for (const control of category.controls) {
          if (control.status === "fail" || control.status === "warning") {
            activeIds.add(control.id);
            activeIds.add(`aws:${control.id}`);
          }
        }
      }
    }
  }

  return { hasGcpSnapshot, hasAwsSnapshot, gcpFetchedAt, awsFetchedAt, activeIds };
}

export async function verifyHandoffTask(params: {
  userEmail: string;
  taskId: string;
  autoComplete?: boolean;
}): Promise<{ task: HandoffTaskRecord; verification: LastVerificationSummary } | null> {
  const task = await getHandoffTask(params.userEmail, params.taskId);
  if (!task) return null;

  const issues = task.payload?.issues ?? [];
  const targets = issues.map(issueToRemediationTarget);

  if (task.payload?.remediationMode === "shirudo_shield") {
    const overview = await getShirudoOverview(params.userEmail);
    const shieldMap = buildAdvisoryShieldMap(overview);
    const healthyNodes = overview.nodes.filter((n) => n.verdict === "ok" || n.verdict === "degraded");

    const resolvedIds: string[] = [];
    const remainingIds: string[] = [];

    for (const issue of issues) {
      const advisories = extractAdvisoryIds([issue]);
      const coveredByAdvisory = advisories.some((adv) => shieldMap.get(adv)?.status === "shielded");
      const coveredByLoadedNode =
        advisories.length === 0 &&
        healthyNodes.some((n) => n.loadedCount > 0 || n.loadedUpatches.length > 0);
      if (coveredByAdvisory || coveredByLoadedNode) {
        resolvedIds.push(issue.id);
      } else {
        remainingIds.push(issue.id);
      }
    }

    const allResolved = issues.length > 0 && remainingIds.length === 0;
    const summary =
      overview.nodes.length === 0
        ? "Cannot verify Shirudo shield: no Shirudo nodes have reported keepalives to Watchmen yet."
        : allResolved
          ? `Verified ${resolvedIds.length} issue${resolvedIds.length === 1 ? "" : "s"} shielded by active Shirudo upatches (${healthyNodes.length} healthy node${healthyNodes.length === 1 ? "" : "s"}).`
          : `${resolvedIds.length} issue${resolvedIds.length === 1 ? "" : "s"} shielded; ${remainingIds.length} awaiting active Shirudo shield deployment.`;

    const verification: LastVerificationSummary = {
      verifiedAt: new Date().toISOString(),
      allResolved,
      resolvedCount: resolvedIds.length,
      remainingCount: remainingIds.length,
      resolvedIds,
      remainingIds,
      summary,
    };

    const updated = await saveHandoffTaskVerification({
      userEmail: params.userEmail,
      taskId: task.id,
      verification,
      autoComplete: params.autoComplete,
    });

    return {
      task: updated ?? task,
      verification,
    };
  }

  const snapshotInfo = await loadLatestStoredIds(params.userEmail);
  const needsGcp = issues.some((i) => i.cloud === "gcp");
  const needsAws = issues.some((i) => i.cloud === "aws");
  const missingRequiredSnapshot =
    (needsGcp && !snapshotInfo.hasGcpSnapshot) ||
    (needsAws && !snapshotInfo.hasAwsSnapshot);

  const resolvedIds = missingRequiredSnapshot
    ? []
    : issues.filter((issue) => !snapshotInfo.activeIds.has(issue.id)).map((issue) => issue.id);
  const remainingIds = missingRequiredSnapshot
    ? issues.map((issue) => issue.id)
    : issues.filter((issue) => snapshotInfo.activeIds.has(issue.id)).map((issue) => issue.id);

  let report: string | undefined;
  let runId: string | undefined;

  // If the user has an AI key configured and only finding targets (verifyFix runs AI summary), record an audited run.
  if (!missingRequiredSnapshot && targets.length > 0) {
    try {
      const resolvedAi = await resolveAI(params.userEmail, false);
      const run = await createAgentRun({
        userEmail: params.userEmail,
        workflow: "verify_fix",
        prompt: `Verify CLI handoff task ${task.id} (${targets.length} targets).`,
        input: {
          sourceTaskId: task.id,
          targets,
        },
      });
      runId = run.id;
      const aiResult = await verifyFix({
        runId: run.id,
        userEmail: params.userEmail,
        isDemoUser: false,
        input: { targets },
        provider: resolvedAi.provider,
        apiKey: resolvedAi.key,
      });
      report = aiResult.report;
      await completeAgentRun({
        runId: run.id,
        status: "completed",
        output: aiResult as unknown as Record<string, unknown>,
      });
    } catch {
      // Fall back to deterministic snapshot verification when AI key is unavailable or AI times out.
    }
  }

  const allResolved = !missingRequiredSnapshot && remainingIds.length === 0 && resolvedIds.length > 0;
  const summary = missingRequiredSnapshot
    ? "Cannot verify fix: run a fresh GCP/AWS scan in Watchmen first so latest snapshots are stored."
    : allResolved
      ? `Verified ${resolvedIds.length} issue${resolvedIds.length === 1 ? "" : "s"} as resolved in the latest snapshots.`
      : `${resolvedIds.length} issue${resolvedIds.length === 1 ? "" : "s"} resolved; ${remainingIds.length} still present in the latest snapshots.`;

  const verification: LastVerificationSummary = {
    verifiedAt: new Date().toISOString(),
    allResolved,
    resolvedCount: resolvedIds.length,
    remainingCount: remainingIds.length,
    resolvedIds,
    remainingIds,
    summary,
    ...(report ? { report } : {}),
    ...(runId ? { runId } : {}),
  };

  const updated = await saveHandoffTaskVerification({
    userEmail: params.userEmail,
    taskId: task.id,
    verification,
    autoComplete: params.autoComplete,
  });

  return {
    task: updated ?? task,
    verification,
  };
}
