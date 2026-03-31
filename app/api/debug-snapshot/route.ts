import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { google } from "googleapis";
import { getUserCloudCredentials, listUserCloudCredentials } from "@/lib/credentials";
import type { GcpSnapshot } from "@/lib/gcp/types";

const TEST_PROJECT = "watchmen-test-488807";

async function liveProbeWithToken(accessToken: string) {
  const oAuth = new google.auth.OAuth2();
  oAuth.setCredentials({ access_token: accessToken });
  const compute = google.compute({ version: "v1", auth: oAuth });

  let computeProbe: unknown;
  try {
    const res = await compute.instances.aggregatedList({ project: TEST_PROJECT, maxResults: 5 });
    const zones = Object.entries(res.data.items ?? {});
    computeProbe = { ok: true, zoneCount: zones.length, sample: zones.slice(0, 3).map(([z, d]) => ({ zone: z, instanceCount: (d as { instances?: unknown[] }).instances?.length ?? 0 })) };
  } catch (err) {
    computeProbe = { ok: false, error: String(err) };
  }

  let firewallProbe: unknown;
  try {
    const res = await compute.firewalls.list({ project: TEST_PROJECT });
    firewallProbe = { ok: true, count: (res.data.items ?? []).length };
  } catch (err) {
    firewallProbe = { ok: false, error: String(err) };
  }

  let cloudRunIamProbe: unknown;
  try {
    const run = google.run({ version: "v1", auth: oAuth });
    const iamRes = await run.projects.locations.services.getIamPolicy({
      resource: `projects/${TEST_PROJECT}/locations/us-central1/services/wm-attack-public-api`,
    });
    cloudRunIamProbe = { ok: true, bindings: iamRes.data.bindings ?? [] };
  } catch (err) {
    cloudRunIamProbe = { ok: false, error: String(err) };
  }

  return { computeProbe, firewallProbe, cloudRunIamProbe };
}

async function liveProbeWithSaKey(saKeyJson: string) {
  const credentials = JSON.parse(saKeyJson);
  const saAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const compute = google.compute({ version: "v1", auth: saAuth });

  let computeProbe: unknown;
  try {
    const res = await compute.instances.aggregatedList({ project: TEST_PROJECT, maxResults: 5 });
    const zones = Object.entries(res.data.items ?? {});
    computeProbe = { ok: true, zoneCount: zones.length };
  } catch (err) {
    computeProbe = { ok: false, error: String(err) };
  }

  let firewallProbe: unknown;
  try {
    const res = await compute.firewalls.list({ project: TEST_PROJECT });
    firewallProbe = { ok: true, count: (res.data.items ?? []).length };
  } catch (err) {
    firewallProbe = { ok: false, error: String(err) };
  }

  return { computeProbe, firewallProbe };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = session.user.email;
  const accessToken = session.accessToken as string | undefined;

  // Determine which auth mode the scan would use
  const gcpCreds = await getUserCloudCredentials(email, "gcp");
  const storedProviders = await listUserCloudCredentials(email);
  const scanAuthMode = gcpCreds ? "service_account_key" : accessToken ? "oauth_token" : "none";

  const oauthProbes = accessToken ? await liveProbeWithToken(accessToken) : null;
  const saProbes = gcpCreds?.serviceAccountKey ? await liveProbeWithSaKey(gcpCreds.serviceAccountKey) : null;

  await ensureGcpSnapshotTable();
  const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${email}`;
  if (result.rows.length === 0) return NextResponse.json({ scanAuthMode, storedProviders, oauthProbes, saProbes, error: "No snapshot" });

  const snap = result.rows[0].snapshot as GcpSnapshot;
  const projects = snap.projects.map((p) => p.projectId);

  return NextResponse.json({
    scanAuthMode,
    storedProviders,
    oauthProbes,
    saProbes,
    snapshotFetchedAt: snap.fetchedAt,
    vmsByProject: Object.fromEntries(
      projects.map((pid) => [pid, snap.vms.filter((v) => v.projectId === pid).map((v) => ({ name: v.name, externalIp: v.externalIp, serviceAccount: v.serviceAccount }))])
    ),
    fwCount: snap.firewallRules.length,
    crIamSample: snap.cloudRunServices.filter((s) => s.projectId === TEST_PROJECT).map((s) => ({ name: s.name, iamBindings: s.iamPolicy.bindings })),
  });
}
