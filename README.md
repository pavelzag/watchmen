# Watchmen

Current version: **v0.4.0**

Cloud security posture management, compliance, and live request tracing — for AWS and GCP — in a single dashboard.

Watchmen scans your cloud infrastructure for misconfigurations, runs SOC 2 Type II and ISO 27001:2022 compliance checks, answers natural-language questions about your environment, and lets you watch live Kubernetes request traffic flow in real time.

---

## v0.4.0 — changes since v0.3.0

This release focuses on making Watchmen more usable as a real multi-cloud operator console: better AWS/GCP parity, clearer scan status, faster navigation, safer task cleanup, and more resilient auth and cloud API handling.

### Multi-cloud views

- Added AWS/GCP filters to **Findings**, so the main findings page can show all cloud issues together or focus on one provider.
- Added AWS/GCP filters to **Attack Path Analysis**.
- Added AWS/GCP filters to **Compliance**, including recalculated score, counts, CSV export, and project breakdown for the selected provider.
- Normalized AWS findings into shared multi-cloud UI models where useful, while keeping GCP-specific remediation flows scoped to GCP.
- Fixed merged compliance category collisions by namespacing internal category/control IDs by provider (`gcp:*`, `aws:*`) while keeping readable `CC6`, `CC6.1.a`, etc. labels in the UI.
- Added visible GCP/AWS badges in multi-cloud Compliance and Findings screens.

### Scan experience and logs

- Added richer **AWS sync logs** in the UI, including credential checks, request lifecycle events, scan IDs, active task state, and snapshot summaries.
- Brought **GCP sync logs** closer to the AWS logging experience.
- Manual sync buttons now fetch fresh scan data and surface progress in the logs section.
- Added no-credentials handling for AWS with clear settings links instead of silent long-running scans.
- Added matching no-credentials UX patterns for GCP where applicable.
- Added structured server-side scan logging with scan IDs for AWS and GCP scan routes.
- Hid noisy partial scan coverage warnings from the main GCP dashboard while keeping full scan coverage available in the dedicated coverage screen.

### Task center reliability

- Added **Clear All Tasks** behavior in the dashboard and task center.
- Added pruning for old finished tasks to prevent task menu buildup.
- Added stale active task handling so restored old sessions do not show ancient tasks as still running.
- Improved task error envelopes for GCP/AWS scan streams with scan IDs and credential-required metadata.

### Keyboard navigation

- Added global dashboard shortcuts:
  - `G` -> GCP
  - `A` -> AWS
  - `T` -> Tasks
  - `R` -> Trace
  - `F` -> Findings
  - `P` -> Attack Paths
  - `D` -> Containers
  - `C` -> Compliance
  - `H` -> History
  - `S` -> Settings
- Added `?` shortcut help modal.
- Added a centered shortcut confirmation badge so route changes feel registered immediately.
- Made shortcut handling more reliable by using document-level capture and ignoring typing targets.

### Authentication and API resilience

- Hardened Google token refresh handling so expired or unreachable refresh flows redirect cleanly instead of causing retry loops.
- Added friendlier login notices for expired sessions and sign-in failures.
- Reduced noisy auth refresh stack traces and preserved actionable error state.
- Fixed GCP API error parsing when Google returns numeric error codes.
- Added a regression test for numeric GCP API error classification.
- Normalized BigQuery dataset metadata handling to avoid runtime type errors.

### UI polish

- Improved AWS and GCP dashboard sync behavior to avoid repeated scan loops.
- Added clearer settings links when cloud credentials are missing.
- Kept AWS-specific and GCP-specific remediation boundaries explicit in shared views.
- Updated visible app version text to **v0.4.0**.

### Verification

- TypeScript type-check passes with `npm run type-check`.
- Added `lib/gcp/client.test.ts` for the numeric Google API error regression.

---

## Features

| Category | Capabilities |
|---|---|
| **GCP scanning** | IAM, service accounts, storage buckets, GKE, Cloud Run, Cloud SQL, BigQuery, Pub/Sub, Secret Manager, Compute VMs, firewall rules |
| **AWS scanning** | IAM users & roles, EC2, EKS, RDS, Lambda, S3, Security Groups, SNS, Secrets Manager, Redshift, Load Balancers |
| **Security findings** | Automated detection of critical misconfigurations with AI-powered remediation guides |
| **Compliance** | SOC 2 Type II (18 controls) and ISO 27001:2022 (18 controls) with score trending and risk acceptance |
| **AI assistant** | Natural-language queries powered by Claude, Gemini, or GPT-4o — press **`/`** to open from anywhere |
| **AI log analysis** | Ask freeform questions about live container logs directly in the topology view |
| **Request tracing** | Live topology graph of Kubernetes traffic with animated pulse on real requests |
| **Multi-user** | Per-user encrypted cloud credentials, AI keys, and compliance history |

---

## Screenshots

| | |
|---|---|
| ![GCP Overview](docs/images/dashboard.png) | ![Security Findings](docs/images/findings.png) |
| **GCP Overview** — all scanned resources at a glance | **Security Findings** — misconfigurations ranked by severity with AI remediation guides |
| ![Compliance](docs/images/compliance.png) | ![Request Tracer](docs/images/request-tracer.png) |
| **Compliance** — SOC 2 Type II and ISO 27001:2022 score with control breakdown | **Request Tracer** — live Kubernetes topology graph with animated request pulses |
| ![Service Accounts](docs/images/service-accounts.png) | ![Settings](docs/images/settings.png) |
| **Service Accounts** — per-account key audit and role assignments | **Settings** — per-user AI keys and encrypted cloud credentials |
| ![AI Query](docs/images/ai-query.png) | ![AI Auth Failures](docs/images/ai-auth-failures.png) |
| **AI Assistant** — press `/` to ask anything about your infrastructure in plain English | **Auth Failure Analysis** — ask about recent login failures and get a grouped breakdown with suspicious pattern detection |

---

## How it works

```mermaid
flowchart LR
    subgraph Users["Users (browser)"]
        U1["Engineer"]
        U2["Security team"]
    end

    subgraph Watchmen["Watchmen (Next.js)"]
        AUTH["Auth\nGoogle OAuth"]
        SCAN["Scanner\nGCP + AWS APIs"]
        SNAP[("Snapshot\nPostgreSQL")]
        NLP["AI Pipeline\nNLP queries"]
        COMP["Compliance\nSOC 2 · ISO 27001"]
        FIND["Findings\nSecurity rules"]
        TRACE["Tracer\nLive K8s graph"]
    end

    subgraph Cloud["Cloud Infrastructure"]
        GCP["GCP\n10+ services"]
        AWS["AWS\n10+ services"]
        K8S["Kubernetes\n+ Istio"]
    end

    subgraph AI["AI Providers\n(user-owned keys)"]
        LLM["Claude · Gemini · GPT-4o"]
    end

    U1 --> AUTH
    U2 --> AUTH
    AUTH --> SCAN
    SCAN -->|cache| SNAP
    SNAP --> NLP
    SNAP --> COMP
    SNAP --> FIND
    NLP --> LLM
    TRACE --> K8S
    SCAN --> GCP
    SCAN --> AWS
```

---

## Quick start — local mock mode

No cloud credentials needed. Uses fixture data.

```bash
git clone https://github.com/YOUR_ORG/watchmen.git
cd watchmen
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:

```
AUTH_SECRET=<openssl rand -base64 32>
DEMO_MODE=true
USE_MOCK_DATA=true
POSTGRES_URL=postgresql://postgres:dev@localhost:5432/watchmen
```

Start a local database:

```bash
docker run -d --name watchmen-pg \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=watchmen \
  -p 5432:5432 postgres:16-alpine

psql postgresql://postgres:dev@localhost:5432/watchmen < scripts/migrate.sql
```

```bash
npm run dev         # normal mode
npm run dev:debug   # debug mode with structured server logs
```

Sign in with the **Enter Demo** button. Go to **Settings → AI Keys** to add a Gemini, Claude, or OpenAI key to enable natural-language queries and AI recommendations.

---

## Documentation

| Guide | Contents |
|---|---|
| [Deployment Guide](docs/deployment.md) | Environment variables, GCP + AWS setup, Google OAuth, database, Vercel, Cloud Run, Kubernetes (full stack + Istio), CI/CD |
| [User Guide](docs/user-guide.md) | Signing in, adding AI keys, queries, findings, compliance, risk acceptance |
| [Architecture](docs/architecture.md) | System diagrams, component map, database schema, request flow |

---

## Architecture at a glance

```mermaid
graph TD
    subgraph K8s["Kubernetes (optional — for live tracing)"]
        PROC["watchmen-processor\n(Go)"]
        ECHO["wm-echo + nginx\n+ istio-proxy"]
    end

    subgraph App["Watchmen App (Next.js 15)"]
        API["API Routes"]
        UI["React UI"]
    end

    subgraph Data["Persistence"]
        PG[("PostgreSQL")]
    end

    subgraph CloudAPIs["Cloud APIs"]
        GCP["GCP\nIAM · GKE · Cloud SQL\nCloud Run · BigQuery…"]
        AWS["AWS\nIAM · EC2 · S3 · RDS\nLambda · EKS…"]
    end

    subgraph AIProviders["AI (user-owned keys)"]
        AI["Claude · Gemini · GPT-4o"]
    end

    Browser["Browser"] --> UI
    UI --> API
    API --> PG
    API --> GCP
    API --> AWS
    API --> AI
    API --> PROC
    PROC --> ECHO
```

See [docs/architecture.md](docs/architecture.md) for the full diagrams including request flow, compliance engine, database schema, and Kubernetes topology.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript (strict) |
| Auth | NextAuth v5, Google OAuth |
| Database | PostgreSQL (Vercel Postgres / Neon / Cloud SQL / self-hosted) |
| AI | Anthropic Claude, Google Gemini, OpenAI GPT-4o |
| Cloud APIs | Google APIs (googleapis), AWS SDK v3 |
| UI | Tailwind CSS, Framer Motion, Lucide |
| Container | Docker (multi-stage, non-root, read-only filesystem) |
| Orchestration | Kubernetes + optional Istio service mesh |
| Tracing | OpenTelemetry → GCP Cloud Trace |
| Processor | Go 1.22 sidecar service |

---

## Repository layout

```
watchmen/
├── app/                  Next.js app router pages and API routes
│   ├── api/              REST API endpoints
│   └── dashboard/        All dashboard pages (GCP, AWS, compliance, trace, settings)
├── lib/                  Shared utilities
│   ├── aws/              AWS SDK wrappers and resource scanners
│   ├── gcp/              GCP API wrappers and resource scanners
│   ├── ai/               Provider-agnostic AI client (Claude / Gemini / OpenAI)
│   ├── compliance/       SOC 2 and ISO 27001 control checks
│   └── encryption.ts     AES-256-GCM key storage
├── services/
│   ├── request-processor/ Go service — traces in-cluster HTTP requests
│   └── test-echo/         Lightweight echo app for topology demos
├── k8s/                  Kubernetes manifests
│   └── istio/            Optional Istio mTLS and access-log telemetry
├── scripts/
│   ├── migrate.sql       Database schema
│   └── terraform/        GCP + AWS test infrastructure (demo environments)
└── docs/                 Extended guides and diagrams
```

---

## Environment variables — quick reference

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | ✅* | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅* | Google OAuth client secret |
| `ALLOWED_EMAILS` | ✅** | Comma-separated allowed emails |
| `ALLOWED_DOMAIN` | ✅** | e.g. `yourcompany.com` |
| `POSTGRES_URL` | ✅ | PostgreSQL connection string |
| `GCP_PROJECTS` | — | Comma-separated GCP project IDs |
| `GCP_SERVICE_ACCOUNT_KEY` | — | Base64-encoded service account JSON |
| `GCP_ORG_ID` | — | Enumerate all org projects automatically |
| `USE_MOCK_DATA` | — | `true` → use fixture data (no cloud API calls) |
| `DEMO_MODE` | — | `true` → auto sign-in, fixture data, no OAuth needed |
| `WATCHMEN_DEBUG` | — | `true` or `1` → enable structured debug logs and timing in key API flows |
| `NEXT_PUBLIC_WATCHMEN_DEBUG` | — | `true` or `1` → expose debug mode to browser code when needed |
| `PROCESSOR_URL` | — | Internal processor service URL (Kubernetes only) |

\* Not required in `DEMO_MODE=true`.
\** At least one required (not needed in `DEMO_MODE=true`).

AWS and GCP credentials for individual users are stored encrypted in the database via **Settings → Cloud Credentials** — no per-deployment AWS env vars needed.

---

## Contributing

```bash
npm run type-check   # TypeScript — no emit
npm run lint         # ESLint
npm test             # Jest unit tests
```

Pull requests welcome. See [docs/deployment.md](docs/deployment.md) for full setup instructions.
