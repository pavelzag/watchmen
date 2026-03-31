import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { google } from "googleapis";
import type { GcpSnapshot } from "@/lib/gcp/types";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Live compute probe — test the actual API call directly with the session token
  const accessToken = session.accessToken as string | undefined;
  let computeProbe: unknown = "no access token in session";
  if (accessToken) {
    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      const compute = google.compute({ version: "v1", auth });
      const res = await compute.instances.aggregatedList({ project: "watchmen-test-488807", maxResults: 5 });
      const zones = Object.entries(res.data.items ?? {});
      computeProbe = {
        ok: true,
        zoneCount: zones.length,
        sample: zones.slice(0, 3).map(([z, d]) => ({ zone: z, instanceCount: (d as { instances?: unknown[] }).instances?.length ?? 0 })),
      };
    } catch (err) {
      computeProbe = { ok: false, error: String(err) };
    }
  }

  await ensureGcpSnapshotTable();
  const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${session.user.email}`;
  if (result.rows.length === 0) return NextResponse.json({ computeProbe, error: "No snapshot" });

  const snap = result.rows[0].snapshot as GcpSnapshot;
  const projects = snap.projects.map((p) => p.projectId);

  return NextResponse.json({
    computeProbe,
    vmsByProject: Object.fromEntries(
      projects.map((pid) => [pid, snap.vms.filter((v) => v.projectId === pid).map((v) => ({ name: v.name, externalIp: v.externalIp, serviceAccount: v.serviceAccount }))])
    ),
    fwsByProject: Object.fromEntries(
      projects.map((pid) => [pid, snap.firewallRules.filter((f) => f.projectId === pid).map((f) => ({ name: f.name, sourceRanges: f.sourceRanges, allowed: f.allowed }))])
    ),
    crByProject: Object.fromEntries(
      projects.map((pid) => [pid, snap.cloudRunServices.filter((s) => s.projectId === pid).map((s) => ({ name: s.name, serviceAccount: s.serviceAccount, iamBindings: s.iamPolicy.bindings }))])
    ),
  });
}
