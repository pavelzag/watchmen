# Watchmen

Cloud security posture management, compliance, and live request tracing — for AWS and GCP — in a single dashboard.

Watchmen scans your cloud infrastructure for misconfigurations, runs SOC 2 Type II and ISO 27001:2022 compliance checks, answers natural-language questions about your environment, and lets you watch live Kubernetes request traffic flow in real time.

---

## Features

| Category | Capabilities |
|---|---|
| **GCP scanning** | IAM, service accounts, storage buckets, GKE, Cloud Run, Cloud SQL, BigQuery, Pub/Sub, Secret Manager, Compute VMs, firewall rules |
| **AWS scanning** | IAM users & roles, EC2, EKS, RDS, Lambda, S3, Security Groups, SNS, Secrets Manager, Redshift, Load Balancers |
| **Security findings** | Automated detection of critical misconfigurations (public buckets, open firewall rules, stale keys, missing MFA, etc.) |
| **Compliance** | SOC 2 Type II (18 controls) and ISO 27001:2022 (18 controls) with score trending and risk acceptance |
| **AI assistant** | Natural-language queries powered by Claude, Gemini, or GPT-4o. Ask "which S3 buckets are public?" or "show me all service accounts with owner role" |
| **AI log analysis** | Ask freeform questions about live container logs directly in the topology view |
| **Request tracing** | Live topology graph of Kubernetes traffic (Internet → LB → istio-proxy → nginx → app), with animated pulse on real requests |
| **Multi-user** | Per-user encrypted cloud credentials, AI keys, and compliance history stored in PostgreSQL |

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
npm run dev   # → http://localhost:3000
```

Sign in with the **Enter Demo** button. Go to **Settings → AI Keys** to add a Gemini, Claude, or OpenAI key and enable natural-language queries and AI recommendations.

---

## Documentation

| Guide | Contents |
|---|---|
| [Deployment Guide](docs/deployment.md) | Environment variables, GCP setup, AWS setup, Google OAuth, database, Vercel, Cloud Run, **Kubernetes (full stack with processor service)**, CI/CD |
| [AWS Setup](docs/aws-setup.md) | Creating an IAM user with least-privilege permissions for scanning |
| [GCP Setup](#) | Service account creation and role assignments (see [Deployment Guide § GCP Setup](docs/deployment.md#gcp-setup)) |
| [User Guide](docs/user-guide.md) | Signing in, adding AI keys, queries, findings, compliance, risk acceptance |
| [Architecture](docs/architecture.md) | System design, component map, database schema, microservices |

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
| Container | Docker (multi-stage, non-root, read-only fs) |
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
├── k8s/                  Kubernetes manifests (namespace, deployment, service, ingress, secrets)
│   └── istio/            Optional Istio mTLS and access-log telemetry
├── scripts/
│   ├── migrate.sql       Database schema
│   └── terraform/        GCP + AWS test infrastructure (for demo environments)
└── docs/                 Extended guides
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
| `USE_MOCK_DATA` | — | `true` → use fixture data (no GCP calls) |
| `DEMO_MODE` | — | `true` → auto sign-in, fixture data, no OAuth needed |
| `PROCESSOR_URL` | — | Internal processor service (Kubernetes only) |

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
