import { randomBytes } from "crypto";
import { ensureShirudoTables, sql } from "@/lib/db";
import {
  decodeCondBits,
  parseOtlpLogsPayload,
  parseOtlpMetricsPayload,
} from "@/lib/shirudo/otlp";
import { verifyShirudoTpmQuote } from "@/lib/shirudo/tpm-verify";
import {
  buildAdvisoryShieldMap,
  type ShirudoNodeRecord,
  type ShirudoOverview,
  type ShirudoShieldHitRecord,
  type ShirudoUpatchFixRecord,
} from "@/lib/shirudo/exposure";

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((item) => String(item));
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      return [];
    }
  }
  return [];
}

function mapNodeRow(row: Record<string, unknown>): ShirudoNodeRecord {
  const cond = Number(row.cond ?? 0);
  return {
    nodeKey: String(row.node_key),
    hostName: String(row.host_name ?? ""),
    akName: row.ak_name ? String(row.ak_name) : null,
    quotePresent: Boolean(row.quote_present),
    quoteVerified: Boolean(row.quote_verified),
    tpmResetCount:
      row.tpm_reset_count === null || row.tpm_reset_count === undefined ? null : Number(row.tpm_reset_count),
    tpmClock: row.tpm_clock === null || row.tpm_clock === undefined ? null : String(row.tpm_clock),
    historyContradiction: Boolean(row.history_contradiction),
    quoteVerificationError: row.quote_verification_error ? String(row.quote_verification_error) : null,
    verdict: String(row.verdict ?? "unknown"),
    cond,
    conditions: decodeCondBits(cond),
    flags: Number(row.flags ?? 0),
    tamperTotal: Number(row.tamper_total ?? 0),
    integrityTotal: Number(row.integrity_total ?? 0),
    kernelRelease: String(row.kernel_release ?? ""),
    imageId: row.image_id ? String(row.image_id) : null,
    imageVersion: row.image_version ? String(row.image_version) : null,
    imageRoot: row.image_root ? String(row.image_root) : null,
    treeId: row.tree_id ? String(row.tree_id) : null,
    lastSeq: row.last_seq === null || row.last_seq === undefined ? null : Number(row.last_seq),
    loadedCount: Number(row.loaded_count ?? 0),
    setSha256: row.set_sha256 ? String(row.set_sha256) : null,
    loadedUpatches: parseJsonArray(row.loaded_upatches),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

export async function ingestShirudoOtlpLogs(params: {
  userEmail: string;
  body: unknown;
}): Promise<{
  totalRecords: number;
  keepalivesProcessed: number;
  mapSnapshotsProcessed: number;
  nodesUpdated: string[];
}> {
  await ensureShirudoTables();
  const parsed = parseOtlpLogsPayload(params.body);
  const nodesUpdated = new Set<string>();

  for (const ka of parsed.keepalives) {
    let historyContradiction = false;
    if (ka.quoteVerified && ka.tpmResetCount !== null && ka.tpmClock !== null) {
      const prevRes = await sql<{ tpm_reset_count: number | null; tpm_clock: string | null }>`
        SELECT tpm_reset_count, tpm_clock
        FROM shirudo_nodes
        WHERE user_email = ${params.userEmail} AND node_key = ${ka.nodeKey}
        LIMIT 1
      `;
      const prev = prevRes.rows[0];
      if (prev && prev.tpm_reset_count !== null && prev.tpm_clock !== null) {
        const prevReset = Number(prev.tpm_reset_count);
        const prevClock = BigInt(prev.tpm_clock);
        const nextClock = BigInt(ka.tpmClock);
        if (ka.tpmResetCount < prevReset || (ka.tpmResetCount === prevReset && nextClock < prevClock)) {
          historyContradiction = true;
        }
      }
    }

    await sql`
      INSERT INTO shirudo_nodes (
        user_email, node_key, host_name, ak_name, quote_present, quote_verified,
        tpm_reset_count, tpm_clock, history_contradiction, quote_verification_error,
        verdict, cond, flags, tamper_total, integrity_total, kernel_release,
        image_id, image_version, image_root, tree_id, last_seq, loaded_count,
        set_sha256, raw_keepalive, last_seen_at, updated_at
      )
      VALUES (
        ${params.userEmail},
        ${ka.nodeKey},
        ${ka.hostName},
        ${ka.akName},
        ${ka.quotePresent},
        ${ka.quoteVerified},
        ${ka.tpmResetCount},
        ${ka.tpmClock},
        ${historyContradiction},
        ${ka.quoteVerificationError},
        ${ka.body.verdict},
        ${ka.body.cond},
        ${ka.body.flags},
        ${ka.tamperTotal},
        ${ka.integrityTotal},
        ${ka.body.kernel_release ?? ""},
        ${ka.body.image_id ?? null},
        ${ka.body.image_version ?? null},
        ${ka.body.image_root ?? null},
        ${ka.body.tree_id ?? null},
        ${ka.body.last_seq ?? null},
        ${Number(ka.body.count ?? 0)},
        ${ka.body.set_sha256 ?? null},
        ${JSON.stringify(ka.body)}::jsonb,
        ${ka.observedAt}::timestamptz,
        NOW()
      )
      ON CONFLICT (user_email, node_key) DO UPDATE SET
        host_name = CASE WHEN EXCLUDED.host_name <> '' AND EXCLUDED.host_name <> 'unknown' THEN EXCLUDED.host_name ELSE shirudo_nodes.host_name END,
        ak_name = COALESCE(EXCLUDED.ak_name, shirudo_nodes.ak_name),
        quote_present = EXCLUDED.quote_present,
        quote_verified = EXCLUDED.quote_verified,
        tpm_reset_count = COALESCE(EXCLUDED.tpm_reset_count, shirudo_nodes.tpm_reset_count),
        tpm_clock = COALESCE(EXCLUDED.tpm_clock, shirudo_nodes.tpm_clock),
        history_contradiction = shirudo_nodes.history_contradiction OR EXCLUDED.history_contradiction,
        quote_verification_error = EXCLUDED.quote_verification_error,
        verdict = EXCLUDED.verdict,
        cond = EXCLUDED.cond,
        flags = EXCLUDED.flags,
        tamper_total = EXCLUDED.tamper_total,
        integrity_total = EXCLUDED.integrity_total,
        kernel_release = EXCLUDED.kernel_release,
        image_id = EXCLUDED.image_id,
        image_version = EXCLUDED.image_version,
        image_root = EXCLUDED.image_root,
        tree_id = EXCLUDED.tree_id,
        last_seq = EXCLUDED.last_seq,
        loaded_count = EXCLUDED.loaded_count,
        set_sha256 = EXCLUDED.set_sha256,
        raw_keepalive = EXCLUDED.raw_keepalive,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = NOW()
    `;
    nodesUpdated.add(ka.nodeKey);
  }

  for (const snap of parsed.mapSnapshots) {
    await sql`
      INSERT INTO shirudo_shield_hits (
        user_email, node_key, host_name, upatch_id, map_name, advisory_id, hit_count, payload, observed_at
      )
      VALUES (
        ${params.userEmail},
        ${snap.nodeKey},
        ${snap.hostName},
        ${snap.upatchId},
        ${snap.mapName},
        ${snap.advisoryId},
        ${snap.hitCount},
        ${JSON.stringify(snap.payload)}::jsonb,
        ${snap.observedAt}::timestamptz
      )
    `;

    // Record active upatch on node if it matches an existing node by key or hostname.
    if (snap.upatchId && snap.upatchId !== "kernel-obs") {
      await sql`
        UPDATE shirudo_nodes
        SET loaded_upatches = CASE
              WHEN NOT (loaded_upatches @> ${JSON.stringify([snap.upatchId])}::jsonb)
                THEN loaded_upatches || ${JSON.stringify([snap.upatchId])}::jsonb
              ELSE loaded_upatches
            END,
            updated_at = NOW()
        WHERE user_email = ${params.userEmail}
          AND (node_key = ${snap.nodeKey} OR (host_name <> '' AND host_name = ${snap.hostName}))
      `;
    }

    if (snap.advisoryId && snap.upatchId) {
      await upsertShirudoUpatchFix({
        userEmail: params.userEmail,
        upatchId: snap.upatchId,
        advisoryId: snap.advisoryId,
        shieldKind: snap.upatchId.toLowerCase().includes("java") ? "java_agent" : "bpf_upatch",
        source: "otlp",
      });
    }
  }

  return {
    totalRecords: parsed.totalRecords,
    keepalivesProcessed: parsed.keepalives.length,
    mapSnapshotsProcessed: parsed.mapSnapshots.length,
    nodesUpdated: [...nodesUpdated],
  };
}

export async function ingestShirudoOtlpMetrics(params: {
  userEmail: string;
  body: unknown;
}): Promise<{
  totalDataPoints: number;
  hitsProcessed: number;
}> {
  await ensureShirudoTables();
  const parsed = parseOtlpMetricsPayload(params.body);

  for (const hit of parsed.hits) {
    await sql`
      INSERT INTO shirudo_shield_hits (
        user_email, node_key, host_name, upatch_id, map_name, advisory_id, hit_count, payload, observed_at
      )
      VALUES (
        ${params.userEmail},
        ${hit.nodeKey},
        ${hit.hostName},
        ${hit.upatchId},
        ${hit.mapName},
        ${hit.advisoryId},
        ${hit.hitCount},
        ${JSON.stringify(hit.payload)}::jsonb,
        ${hit.observedAt}::timestamptz
      )
    `;

    if (hit.advisoryId && hit.upatchId) {
      await upsertShirudoUpatchFix({
        userEmail: params.userEmail,
        upatchId: hit.upatchId,
        advisoryId: hit.advisoryId,
        shieldKind: hit.upatchId.toLowerCase().includes("java") ? "java_agent" : "bpf_upatch",
        source: "otlp",
      });
    }
  }

  return {
    totalDataPoints: parsed.totalDataPoints,
    hitsProcessed: parsed.hits.length,
  };
}

export async function upsertShirudoUpatchFix(params: {
  userEmail: string;
  upatchId: string;
  advisoryId: string;
  treeId?: string;
  shieldKind?: "bpf_upatch" | "java_agent";
  source?: string;
}): Promise<ShirudoUpatchFixRecord> {
  await ensureShirudoTables();
  const upatchId = params.upatchId.trim().slice(0, 128);
  const advisoryId = params.advisoryId.trim().toUpperCase().slice(0, 64);
  const treeId = (params.treeId ?? "").trim().slice(0, 128);
  const shieldKind = params.shieldKind === "java_agent" ? "java_agent" : "bpf_upatch";
  const source = (params.source ?? "manual").trim().slice(0, 32);

  const res = await sql`
    INSERT INTO shirudo_upatch_fixes (
      user_email, upatch_id, advisory_id, tree_id, shield_kind, source
    )
    VALUES (
      ${params.userEmail}, ${upatchId}, ${advisoryId}, ${treeId}, ${shieldKind}, ${source}
    )
    ON CONFLICT (user_email, upatch_id, advisory_id) DO UPDATE SET
      tree_id = CASE WHEN EXCLUDED.tree_id <> '' THEN EXCLUDED.tree_id ELSE shirudo_upatch_fixes.tree_id END,
      shield_kind = EXCLUDED.shield_kind,
      source = EXCLUDED.source,
      updated_at = NOW()
    RETURNING upatch_id, advisory_id, tree_id, shield_kind, source, updated_at
  `;

  const row = res.rows[0];
  return {
    upatchId: String(row.upatch_id),
    advisoryId: String(row.advisory_id),
    treeId: String(row.tree_id ?? ""),
    shieldKind: row.shield_kind === "java_agent" ? "java_agent" : "bpf_upatch",
    source: String(row.source ?? "manual"),
    updatedAt: toIso(row.updated_at),
  };
}

export async function deleteShirudoUpatchFix(params: {
  userEmail: string;
  upatchId: string;
  advisoryId: string;
}): Promise<boolean> {
  await ensureShirudoTables();
  const res = await sql`
    DELETE FROM shirudo_upatch_fixes
    WHERE user_email = ${params.userEmail}
      AND upatch_id = ${params.upatchId.trim()}
      AND advisory_id = ${params.advisoryId.trim().toUpperCase()}
    RETURNING upatch_id
  `;
  return res.rows.length > 0;
}

export async function getShirudoOverview(userEmail: string): Promise<ShirudoOverview> {
  await ensureShirudoTables();

  const [nodesRes, fixesRes, hitsRes] = await Promise.all([
    sql`
      SELECT * FROM shirudo_nodes
      WHERE user_email = ${userEmail}
      ORDER BY last_seen_at DESC
      LIMIT 200
    `,
    sql`
      SELECT upatch_id, advisory_id, tree_id, shield_kind, source, updated_at
      FROM shirudo_upatch_fixes
      WHERE user_email = ${userEmail}
      ORDER BY updated_at DESC
      LIMIT 200
    `,
    sql`
      SELECT id, node_key, host_name, upatch_id, map_name, advisory_id, hit_count, observed_at
      FROM shirudo_shield_hits
      WHERE user_email = ${userEmail}
      ORDER BY observed_at DESC
      LIMIT 100
    `,
  ]);

  const nodes = nodesRes.rows.map((r) => mapNodeRow(r));
  const fixes: ShirudoUpatchFixRecord[] = fixesRes.rows.map((r) => ({
    upatchId: String(r.upatch_id),
    advisoryId: String(r.advisory_id),
    treeId: String(r.tree_id ?? ""),
    shieldKind: r.shield_kind === "java_agent" ? "java_agent" : "bpf_upatch",
    source: String(r.source ?? "manual"),
    updatedAt: toIso(r.updated_at),
  }));
  const recentHits: ShirudoShieldHitRecord[] = hitsRes.rows.map((r) => ({
    id: Number(r.id),
    nodeKey: String(r.node_key),
    hostName: String(r.host_name ?? ""),
    upatchId: String(r.upatch_id),
    mapName: String(r.map_name ?? ""),
    advisoryId: r.advisory_id ? String(r.advisory_id) : null,
    hitCount: Number(r.hit_count ?? 0),
    observedAt: toIso(r.observed_at),
  }));

  const healthyNodes = nodes.filter((n) => n.verdict === "ok" || n.verdict === "degraded").length;
  const tamperedNodes = nodes.filter((n) => n.verdict === "tampered" || n.verdict === "lsm-off").length;
  const quotedNodes = nodes.filter((n) => n.quotePresent).length;
  const verifiedNodes = nodes.filter((n) => n.quoteVerified).length;
  const contradictionNodes = nodes.filter((n) => n.historyContradiction).length;
  const totalBlockedHits = recentHits.reduce((sum, h) => sum + h.hitCount, 0);

  const overview: ShirudoOverview = {
    nodes,
    fixes,
    recentHits,
    summary: {
      totalNodes: nodes.length,
      healthyNodes,
      tamperedNodes,
      quotedNodes,
      verifiedNodes,
      contradictionNodes,
      shieldedAdvisories: 0,
      totalBlockedHits,
    },
  };

  const shieldMap = buildAdvisoryShieldMap(overview);
  overview.summary.shieldedAdvisories = [...shieldMap.values()].filter((s) => s.status === "shielded").length;

  return overview;
}

export interface ShirudoAttestationChallengeRecord {
  id: string;
  nodeKey: string;
  nonce: string;
  status: "pending" | "verified" | "failed" | "expired";
  error: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
}

export async function createShirudoAttestationChallenge(params: {
  userEmail: string;
  nodeKey: string;
}): Promise<ShirudoAttestationChallengeRecord> {
  await ensureShirudoTables();
  const id = `att_${randomBytes(8).toString("hex")}`;
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  const res = await sql`
    INSERT INTO shirudo_attestation_challenges (id, user_email, node_key, nonce, status, expires_at)
    VALUES (${id}, ${params.userEmail}, ${params.nodeKey.trim()}, ${nonce}, 'pending', ${expiresAt}::timestamptz)
    RETURNING id, node_key, nonce, status, error, expires_at, verified_at, created_at
  `;
  const row = res.rows[0];
  return {
    id: String(row.id),
    nodeKey: String(row.node_key),
    nonce: String(row.nonce),
    status: "pending",
    error: null,
    expiresAt: toIso(row.expires_at),
    verifiedAt: null,
    createdAt: toIso(row.created_at),
  };
}

export async function listShirudoAttestationChallenges(
  userEmail: string
): Promise<ShirudoAttestationChallengeRecord[]> {
  await ensureShirudoTables();
  const res = await sql`
    SELECT id, node_key, nonce, status, error, expires_at, verified_at, created_at
    FROM shirudo_attestation_challenges
    WHERE user_email = ${userEmail}
    ORDER BY created_at DESC
    LIMIT 25
  `;
  return res.rows.map((row) => ({
    id: String(row.id),
    nodeKey: String(row.node_key),
    nonce: String(row.nonce),
    status: String(row.status) as ShirudoAttestationChallengeRecord["status"],
    error: row.error ? String(row.error) : null,
    expiresAt: toIso(row.expires_at),
    verifiedAt: row.verified_at ? toIso(row.verified_at) : null,
    createdAt: toIso(row.created_at),
  }));
}

export async function verifyShirudoAttestationChallenge(params: {
  userEmail: string;
  challengeId: string;
  quoteRaw: string;
}): Promise<{ challenge: ShirudoAttestationChallengeRecord; verified: boolean; reason?: string } | null> {
  await ensureShirudoTables();
  const res = await sql`
    SELECT id, node_key, nonce, status, error, expires_at, verified_at, created_at
    FROM shirudo_attestation_challenges
    WHERE user_email = ${params.userEmail} AND id = ${params.challengeId}
    LIMIT 1
  `;
  const row = res.rows[0];
  if (!row) return null;

  const expiresAt = toIso(row.expires_at);
  if (Date.now() > new Date(expiresAt).getTime()) {
    await sql`
      UPDATE shirudo_attestation_challenges
      SET status = 'expired', error = 'Challenge nonce expired'
      WHERE id = ${params.challengeId} AND user_email = ${params.userEmail}
    `;
    return {
      verified: false,
      reason: "Challenge nonce expired",
      challenge: {
        id: String(row.id),
        nodeKey: String(row.node_key),
        nonce: String(row.nonce),
        status: "expired",
        error: "Challenge nonce expired",
        expiresAt,
        verifiedAt: null,
        createdAt: toIso(row.created_at),
      },
    };
  }

  const nonceBuf = Buffer.from(String(row.nonce), "hex");
  const verification = verifyShirudoTpmQuote({
    quoteRaw: params.quoteRaw,
    expectedExtraData: nonceBuf,
    requireEmptyPcrSelect: false,
  });

  if (verification.verified) {
    await sql`
      UPDATE shirudo_attestation_challenges
      SET status = 'verified', error = NULL, verified_at = NOW()
      WHERE id = ${params.challengeId} AND user_email = ${params.userEmail}
    `;
    await sql`
      UPDATE shirudo_nodes
      SET quote_present = TRUE,
          quote_verified = TRUE,
          quote_verification_error = NULL,
          ak_name = COALESCE(${verification.akName}, ak_name),
          tpm_reset_count = COALESCE(${verification.resetCount}, tpm_reset_count),
          tpm_clock = COALESCE(${verification.clock}, tpm_clock),
          updated_at = NOW()
      WHERE user_email = ${params.userEmail}
        AND (node_key = ${String(row.node_key)} OR ak_name = ${verification.akName})
    `;
    return {
      verified: true,
      challenge: {
        id: String(row.id),
        nodeKey: String(row.node_key),
        nonce: String(row.nonce),
        status: "verified",
        error: null,
        expiresAt,
        verifiedAt: new Date().toISOString(),
        createdAt: toIso(row.created_at),
      },
    };
  }

  const reason = verification.reason ?? "TPM challenge verification failed";
  await sql`
    UPDATE shirudo_attestation_challenges
    SET status = 'failed', error = ${reason}
    WHERE id = ${params.challengeId} AND user_email = ${params.userEmail}
  `;
  return {
    verified: false,
    reason,
    challenge: {
      id: String(row.id),
      nodeKey: String(row.node_key),
      nonce: String(row.nonce),
      status: "failed",
      error: reason,
      expiresAt,
      verifiedAt: null,
      createdAt: toIso(row.created_at),
    },
  };
}
