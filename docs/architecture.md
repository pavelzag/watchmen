# Watchmen — Architecture

## System overview

```
Browser (Next.js 15 App Router)
  │
  ├── /api/scan                → triggers a GCP snapshot for the signed-in user
  ├── /api/query               → NLP: intent extraction → answer generation
  ├── /api/compliance          → SOC 2 / ISO 27001 report from snapshot
  ├── /api/compliance/ai       → per-control AI remediation advice
  ├── /api/compliance/history  → compliance score trend data
  ├── /api/compliance/suppress → risk acceptance (suppress / revoke controls)
  ├── /api/findings            → security findings from snapshot
  └── /api/settings/keys       → user AI key management (encrypted, per-user)
       │
       ├── NextAuth v5  ── Google OAuth (cloud-platform scope + offline access)
       ├── PostgreSQL   ── snapshots, compliance history, suppressions, AI keys
       └── GCP APIs (googleapis)
             ├── Cloud Resource Manager  (projects, IAM)
             ├── IAM Admin               (service accounts, keys)
             ├── GKE / Container         (clusters)
             ├── Cloud SQL Admin         (instances)
             ├── Cloud Run               (services)
             ├── Cloud Storage           (buckets, IAM policies)
             ├── BigQuery                (datasets)
             ├── Pub/Sub                 (topics)
             ├── Secret Manager          (secrets)
             └── Compute Engine          (VMs, firewall rules)
```

## Key design decisions

### Per-user OAuth scanning
Each signed-in user's GCP data is fetched using **their own OAuth access token** obtained during Google sign-in (`cloud-platform` scope). The service account key (`GCP_SERVICE_ACCOUNT_KEY`) is used only as a server-side fallback for background re-scans. This means Watchmen never needs org-wide service account permissions that exceed what the individual user already has.

### Snapshot-based queries
GCP APIs are called once per scan, and the result is serialised as JSONB in Postgres. All subsequent NLP queries, finding computations, and compliance reports read from this cached snapshot — no extra GCP API calls at query time. The dashboard triggers a fresh scan automatically every 10 minutes in the background.

### AI keys are user-owned
Every AI API call (NLP queries, compliance AI recommendations) uses the key the user added in **Settings → AI Keys**. Keys are AES-256-GCM encrypted before being stored in Postgres. No server-side AI key is required at deploy time.

### Pure-function compliance engine
All SOC 2 and ISO 27001 control checks are pure functions in `lib/compliance/checks.ts` — they take a snapshot object and return pass/fail/warning evidence lists. No API calls happen during compliance report generation.

## Component map

| Path | Purpose |
|---|---|
| `lib/auth.ts` | NextAuth config — Google provider, JWT/session callbacks, email/domain allowlist |
| `lib/db.ts` | Re-exports `sql` from `@vercel/postgres` — works with any PostgreSQL URL |
| `lib/gcp/client.ts` | SA auth (`initGoogleAuth`), user OAuth auth (`initUserAuth`), org-level project enumeration |
| `lib/gcp/index.ts` | `fetchGcpSnapshot()` — orchestrates all GCP fetchers |
| `lib/gcp/types.ts` | All GCP type definitions |
| `lib/claude/query-processor.ts` | 2-pass AI flow: intent extraction → answer generation. Uses the user's active AI key. |
| `lib/ai/client.ts` | `resolveAI()`, `callAI()` — provider-agnostic AI abstraction (Gemini, Claude, OpenAI) |
| `lib/compliance/checks.ts` | 18 shared GCP check functions (pure) |
| `lib/compliance/soc2.ts` | SOC 2 Type II report builder (18 controls across CC6, C1, CC7, A1) |
| `lib/compliance/iso27001.ts` | ISO 27001:2022 report builder (18 controls across A.5, A.8) |
| `lib/findings.ts` | `computeFindings()` — 12 security rules, pure function |
| `lib/snapshot-history.ts` | localStorage snapshot CRUD + diff between two snapshots |
| `lib/query-history.ts` | localStorage NLP query history (last 20 entries) |
| `fixtures/` | Mock JSON for development without GCP credentials |

## Database schema

```sql
-- Latest GCP snapshot per user
user_snapshots (
  user_email  TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ
)

-- AI provider keys (AES-256-GCM encrypted)
user_api_keys (
  user_email    TEXT,
  provider      TEXT,     -- 'google' | 'openai' | 'anthropic'
  encrypted_key TEXT,     -- iv:authTag:ciphertext
  key_hint      TEXT,     -- last 4 chars of original key
  is_active     BOOLEAN,
  PRIMARY KEY (user_email, provider)
)

-- Compliance score history (for trend chart)
compliance_history (
  id               BIGSERIAL PRIMARY KEY,
  user_email       TEXT,
  standard         TEXT,   -- 'soc2' | 'iso27001'
  score            INT,
  total_controls   INT,
  failing_controls INT,
  warning_controls INT,
  recorded_at      TIMESTAMPTZ
)

-- Per-user risk acceptances
compliance_suppressions (
  user_email    TEXT,
  control_id    TEXT,     -- e.g. 'CC6.7.a'
  justification TEXT,
  suppressed_at TIMESTAMPTZ,
  PRIMARY KEY (user_email, control_id)
)
```

## GCP resources scanned

| Resource | API | Fields captured |
|---|---|---|
| IAM / Projects | Cloud Resource Manager v1 | Bindings (role → members) |
| Service Accounts | IAM Admin v1 | Keys, roles, disabled state |
| Storage Buckets | Storage v1 | IAM policy, location, versioning |
| GKE Clusters | Container v1 | Version, node count, Workload Identity, private nodes |
| VMs | Compute v1 | Zone, machine type, external IP, service account |
| Cloud Run | Run v1 | Region, service account, IAM policy |
| Cloud SQL | SQL Admin v1beta4 | Public IP, backup enabled, SSL required |
| BigQuery | BigQuery v2 | Dataset IAM policy, location |
| Pub/Sub | Pub/Sub v1 | Topic IAM policy |
| Secret Manager | SecretManager v1 | IAM policy, replication policy |
| Firewall Rules | Compute v1 | Direction, source ranges, allowed ports |

## AI provider support

Watchmen is provider-agnostic. Users pick whichever AI they have API access to:

| Provider | Model used | Key format |
|---|---|---|
| Google Gemini | `gemini-2.5-flash` | `AIza…` |
| Anthropic Claude | `claude-sonnet-4-6` | `sk-ant-…` |
| OpenAI | `gpt-4o-mini` | `sk-…` |

Keys are validated against the live API before being saved, then AES-256-GCM encrypted in Postgres. Only the last 4 characters are stored in plaintext as a hint.

## Mock mode

Set `USE_MOCK_DATA=true` to run the full application with fixture data from `fixtures/`. No GCP credentials are needed — all NLP queries, findings, and compliance reports work against the fixture snapshot. A user AI key is still required for AI-powered features.
