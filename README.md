# Watchmen — GCP IAM Explorer

Query your GCP infrastructure using natural language. Watchmen scans IAM policies, service accounts, GKE clusters, Cloud SQL, Cloud Run, storage buckets, firewall rules, secrets, and more — then lets you ask questions like *"Which service accounts have owner roles?"* or *"Show me public buckets in project X"*.

It also runs automated **SOC 2** and **ISO 27001** compliance checks against your live infrastructure.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start — local mock mode](#quick-start--local-mock-mode)
5. [Environment Variables](#environment-variables)
6. [GCP Setup](#gcp-setup)
7. [Google OAuth Setup](#google-oauth-setup)
8. [Database Setup](#database-setup)
9. [Deploying to Vercel](#deploying-to-vercel)
10. [Deploying to GCP Cloud Run](#deploying-to-gcp-cloud-run)
11. [Deploying to Kubernetes](#deploying-to-kubernetes)
12. [GitHub Actions CI/CD](#github-actions-cicd)
13. [Development](#development)
14. [Access Control](#access-control)

---

## Features

| Category | Details |
|---|---|
| **NLP Queries** | Natural language queries over IAM, service accounts, GKE, Cloud Run, Cloud SQL, BigQuery, Pub/Sub, Secrets, VMs, Firewall rules |
| **Security Findings** | 12 automated security rules (public buckets, primitive SA roles, stale keys, open firewall, SSH/RDP exposure, etc.) |
| **Compliance** | SOC 2 Type II (18 controls) and ISO 27001:2022 (18 controls) with per-control risk acceptance and score history |
| **AI Remediation** | Per-control AI recommendations via Gemini, Claude, or OpenAI |
| **Per-user scans** | Each user's GCP data is fetched with their own OAuth token and stored in Postgres |
| **Mock mode** | `USE_MOCK_DATA=true` runs the full app with fixture data — no GCP credentials needed |

---

## Architecture

```
Browser (Next.js 15 App Router)
  │
  ├── /api/scan             → triggers a GCP snapshot for the signed-in user
  ├── /api/query            → NLP: Gemini extracts intent → runs against snapshot
  ├── /api/compliance       → generates SOC 2 / ISO 27001 report from snapshot
  ├── /api/findings         → computes security findings from snapshot
  ├── /api/compliance/ai    → per-control AI remediation advice
  ├── /api/compliance/history  → compliance score trend data
  └── /api/compliance/suppress → risk acceptance (suppress/revoke controls)
       │
       ├── NextAuth v5 (Google OAuth — cloud-platform scope)
       ├── PostgreSQL  ←  stores snapshots, compliance history, suppressions, API keys
       └── GCP APIs (googleapis)
             ├── IAM / Cloud Resource Manager
             ├── GKE / Container
             ├── Cloud SQL Admin
             ├── Cloud Run
             ├── Cloud Storage
             ├── BigQuery
             ├── Pub/Sub
             ├── Secret Manager
             └── Compute Engine (VMs + Firewall)
```

**Key design decisions:**
- Each signed-in user fetches GCP data with their **own OAuth access token** (not a shared service account). The service account key is used as a fallback for scanning.
- Snapshots are stored in Postgres; the UI reads from the DB and triggers a rescan in the background every 10 minutes.
- All compliance checks are pure functions — no extra API calls at report time.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | |
| npm | ≥ 10 | bundled with Node 20 |
| Docker | any recent | for container builds |
| Google Cloud account | — | for real GCP data |
| PostgreSQL | ≥ 14 | Vercel Postgres, Neon, Cloud SQL, or self-hosted |

---

## Quick Start — local mock mode

Get the app running in under 5 minutes with no GCP credentials.

```bash
git clone https://github.com/YOUR_ORG/watchmen.git
cd watchmen
npm install
cp .env.local.example .env.local
```

Edit `.env.local` with the minimum set for mock mode:

```env
AUTH_SECRET=any_random_32_char_string      # openssl rand -base64 32
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
ALLOWED_EMAILS=you@example.com
GEMINI_API_KEY=your_gemini_key
USE_MOCK_DATA=true
POSTGRES_URL=postgresql://postgres:dev@localhost:5432/watchmen
```

**Spin up a local Postgres (if you don't have one):**

```bash
docker run -d --name watchmen-pg \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=watchmen \
  -p 5432:5432 \
  postgres:16-alpine

psql postgresql://postgres:dev@localhost:5432/watchmen < scripts/migrate.sql
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the Google account in `ALLOWED_EMAILS`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | ✅ | Random secret for NextAuth. Generate: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth 2.0 client secret |
| `ALLOWED_EMAILS` | ✅* | Comma-separated list of allowed email addresses |
| `ALLOWED_DOMAIN` | ✅* | Domain restriction, e.g. `yourcompany.com`. Use instead of, or alongside, `ALLOWED_EMAILS` |
| `GEMINI_API_KEY` | ✅ | Gemini API key — used for NLP query processing and compliance AI |
| `USE_MOCK_DATA` | — | `true` to use fixture data instead of real GCP. Default: `false` |
| `GCP_PROJECTS` | ✅** | Comma-separated GCP project IDs to scan |
| `GCP_SERVICE_ACCOUNT_KEY` | ✅** | Base64-encoded service account JSON key |
| `GCP_ORG_ID` | — | GCP organisation ID. When set, all projects in the org are enumerated automatically |
| `POSTGRES_URL` | ✅ | PostgreSQL connection string — any PostgreSQL-compatible URL |
| `ANTHROPIC_API_KEY` | — | Optional. Enables Claude for AI remediation (users can also add their own key in Settings) |
| `OPENAI_API_KEY` | — | Optional. Enables OpenAI for AI remediation |

\* At least one of `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` is required.
\** Required when `USE_MOCK_DATA=false`.

---

## GCP Setup

### 1. Create a service account

```bash
export PROJECT_ID=my-gcp-project

gcloud iam service-accounts create watchmen-reader \
  --display-name="Watchmen Reader" \
  --project=$PROJECT_ID

# Grant read-only roles for every resource type Watchmen scans
for role in \
  roles/iam.securityReviewer \
  roles/storage.objectViewer \
  roles/container.viewer \
  roles/cloudsql.viewer \
  roles/run.viewer \
  roles/bigquery.metadataViewer \
  roles/pubsub.viewer \
  roles/secretmanager.viewer \
  roles/compute.networkViewer; do
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
      --role="$role"
done
```

### 2. Export and encode the key

```bash
gcloud iam service-accounts keys create sa-key.json \
  --iam-account="watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com"

# Single-line base64 — paste this value into GCP_SERVICE_ACCOUNT_KEY
base64 -i sa-key.json | tr -d '\n'

rm sa-key.json   # don't leave the key on disk
```

### 3. (Optional) Organisation-wide scanning

Set `GCP_ORG_ID` and grant the SA reader access at org level:

```bash
gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.securityReviewer"
```

---

## Google OAuth Setup

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID** (Web application).
2. Add **Authorized redirect URIs** for every environment:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://your-domain.com/api/auth/callback/google`
3. Copy the **Client ID** and **Client Secret** into your environment variables.
4. On the **OAuth consent screen**, ensure the `cloud-platform` scope is approved, or GCP scans will fail with a 403.

---

## Database Setup

Watchmen works with any PostgreSQL ≥ 14 connection string in `POSTGRES_URL`. Run the migration once before starting the app:

```bash
psql $POSTGRES_URL < scripts/migrate.sql
```

This creates four tables:

| Table | Purpose |
|---|---|
| `user_snapshots` | Latest GCP snapshot per user (JSONB) |
| `user_api_keys` | Encrypted AI provider keys per user |
| `compliance_history` | Score history for trend charts |
| `compliance_suppressions` | Per-user risk acceptances for compliance controls |

**PostgreSQL options:**
- **Vercel Postgres** (managed Neon) — easiest for Vercel deployments
- **Neon** (`postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`) — serverless, free tier
- **GCP Cloud SQL** — set `POSTGRES_URL` to the private/public IP or use the Unix socket path
- **Self-hosted** (`postgresql://user:pass@host:5432/watchmen`)

---

## Deploying to Vercel

```bash
npx vercel
```

Or connect the GitHub repo in the [Vercel dashboard](https://vercel.com/new) for automatic deploys on push.

**Checklist:**
- Framework preset: **Next.js** (auto-detected)
- Add all env vars in **Settings → Environment Variables**
- Provision a Postgres database via the **Storage** tab — `POSTGRES_URL` is injected automatically
- Run the migration from your local machine pointing at the Vercel Postgres URL
- Add `https://your-app.vercel.app/api/auth/callback/google` to your Google OAuth redirect URIs

---

## Deploying to GCP Cloud Run

Cloud Run is a natural fit — managed HTTPS, scale-to-zero, and native GCP integration.

### Prerequisites

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### Option A — Deploy from source (uses Cloud Build, no Docker needed locally)

```bash
gcloud run deploy watchmen \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production \
  --set-secrets \
AUTH_SECRET=watchmen-auth-secret:latest,\
GOOGLE_CLIENT_ID=watchmen-google-client-id:latest,\
GOOGLE_CLIENT_SECRET=watchmen-google-client-secret:latest,\
ALLOWED_EMAILS=watchmen-allowed-emails:latest,\
GEMINI_API_KEY=watchmen-gemini-key:latest,\
GCP_PROJECTS=watchmen-gcp-projects:latest,\
GCP_SERVICE_ACCOUNT_KEY=watchmen-sa-key:latest,\
POSTGRES_URL=watchmen-postgres-url:latest
```

> Store secrets in **GCP Secret Manager** first:
> ```bash
> echo -n "my-secret-value" | gcloud secrets create watchmen-auth-secret --data-file=-
> ```

### Option B — Deploy a pre-built image from GHCR

After the [GitHub Action](#github-actions-cicd) pushes an image:

```bash
gcloud run deploy watchmen \
  --image ghcr.io/YOUR_ORG/watchmen:main \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --set-secrets "AUTH_SECRET=watchmen-auth-secret:latest,..."
```

### Cloud SQL (private IP)

Use the Unix socket to connect without exposing a public database:

```
POSTGRES_URL=postgresql://USER:PASS@/DBNAME?host=/cloudsql/PROJECT:REGION:INSTANCE
```

Grant the Cloud Run service account `roles/cloudsql.client`:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

Add `--add-cloudsql-instances=PROJECT:REGION:INSTANCE` to the `gcloud run deploy` command.

### Custom domain

```bash
gcloud run domain-mappings create \
  --service watchmen \
  --domain watchmen.example.com \
  --region us-central1
```

Follow the DNS instructions printed by the command, then add `https://watchmen.example.com/api/auth/callback/google` to your Google OAuth redirect URIs.

---

## Deploying to Kubernetes

All manifests live in `k8s/`. Apply them all at once with kustomize, or individually.

### Prerequisites

```bash
# nginx ingress controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# cert-manager (automatic Let's Encrypt TLS)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace \
  --set installCRDs=true

# Let's Encrypt ClusterIssuer — replace ops@example.com with your email
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### Step 1 — Run the database migration

```bash
psql $POSTGRES_URL < scripts/migrate.sql
```

### Step 2 — Create the namespace and secret

```bash
kubectl apply -f k8s/namespace.yaml

kubectl create secret generic watchmen-env \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  --from-literal=GOOGLE_CLIENT_SECRET="your-client-secret" \
  --from-literal=ALLOWED_EMAILS="admin@example.com" \
  --from-literal=GEMINI_API_KEY="your-gemini-key" \
  --from-literal=USE_MOCK_DATA="false" \
  --from-literal=GCP_PROJECTS="project-a,project-b" \
  --from-literal=GCP_SERVICE_ACCOUNT_KEY="$(base64 -i sa-key.json | tr -d '\n')" \
  --from-literal=POSTGRES_URL="postgresql://user:pass@host:5432/watchmen" \
  -n watchmen
```

### Step 3 — Set your image and domain

In `k8s/deployment.yaml`, replace `YOUR_GITHUB_ORG`:

```yaml
image: ghcr.io/YOUR_GITHUB_ORG/watchmen:main
```

In `k8s/ingress.yaml`, replace both occurrences of `watchmen.example.com` with your real domain.

### Step 4 — Apply

```bash
# All manifests at once (skips secret.yaml — you created it above)
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

# Or use kustomize (edit k8s/secret.yaml placeholders first)
kubectl apply -k k8s/
```

### Step 5 — Verify

```bash
kubectl get pods -n watchmen -w
kubectl rollout status deployment/watchmen -n watchmen
kubectl logs -n watchmen -l app=watchmen -f
kubectl get ingress -n watchmen   # TLS cert may take ~60s
```

### Pulling from a private GHCR package

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT \
  -n watchmen
```

Uncomment the `imagePullSecrets` block in `k8s/deployment.yaml`.

### Rolling update after a new build

```bash
kubectl set image deployment/watchmen \
  watchmen=ghcr.io/YOUR_ORG/watchmen:sha-<NEW_SHA> \
  -n watchmen

kubectl rollout status deployment/watchmen -n watchmen
```

---

## GitHub Actions CI/CD

Two workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push / PR to `main` | TypeScript check (`tsc --noEmit`) + ESLint |
| `docker.yml` | Push to `main`, semver tags (`v*`) | Multi-platform build, push to GHCR |

### Image tags produced

| Git event | Tags |
|---|---|
| Push to `main` | `:main`, `:sha-abc1234` |
| Tag `v1.2.3` | `:1.2.3`, `:1.2`, `:1`, `:latest`, `:sha-abc1234` |
| Pull request | Build only — **not pushed** |

### Making the GHCR package public

After the first successful push: GitHub → your repo → **Packages** → `watchmen` → **Package settings** → **Make public**.
This lets Kubernetes pull without an `imagePullSecret`.

---

## Development

```bash
npm run dev         # dev server at http://localhost:3000 (with hot reload)
npm run build       # production build
npm run start       # serve the production build locally
npm run type-check  # TypeScript — no emit
npm run lint        # ESLint
```

### Build and run with Docker locally

```bash
docker build -t watchmen:dev .

docker run --rm -p 3000:3000 \
  --env-file .env.local \
  watchmen:dev
```

### Mock data

Fixture files in `fixtures/` simulate 3 GCP projects with realistic IAM bindings, service accounts, buckets, GKE clusters, VMs, Cloud Run services, Cloud SQL instances, BigQuery datasets, Pub/Sub topics, secrets, and firewall rules.

Set `USE_MOCK_DATA=true` — no GCP credentials needed, and the NLP query engine, security findings, and compliance checks all work against the fixture data.

---

## Access Control

Only Google accounts matching `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` can reach the dashboard. Unauthenticated requests are redirected to the login page by NextAuth middleware.

| Variable | Example | Behaviour |
|---|---|---|
| `ALLOWED_EMAILS` | `alice@corp.com,bob@corp.com` | Allowlist specific accounts |
| `ALLOWED_DOMAIN` | `corp.com` | Allow anyone with a `@corp.com` Google account |

Both variables can be set simultaneously (union of both lists).
