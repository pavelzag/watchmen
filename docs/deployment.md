# Watchmen — Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Demo Deployment](#demo-deployment)
4. [GCP Setup](#gcp-setup)
5. [Google OAuth Setup](#google-oauth-setup)
6. [Database Setup](#database-setup)
7. [Access Control](#access-control)
8. [Vercel](#vercel)
9. [GCP Cloud Run](#gcp-cloud-run)
10. [Kubernetes](#kubernetes)
11. [GitHub Actions CI/CD](#github-actions-cicd)
12. [Local development](#local-development)

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Docker | any recent (for container builds) |
| PostgreSQL | ≥ 14 |
| gcloud CLI | latest (for Cloud Run / GCP setup) |
| kubectl + helm | latest (for Kubernetes) |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | ✅ | Random secret for NextAuth. Generate: `openssl rand -base64 32` |
| `DEMO_MODE` | — | `true` enables one-click demo sign-in with fixture data. No GCP or OAuth needed. |
| `GOOGLE_CLIENT_ID` | ✅*** | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅*** | Google OAuth 2.0 client secret |
| `ALLOWED_EMAILS` | ✅* | Comma-separated list of allowed email addresses |
| `ALLOWED_DOMAIN` | ✅* | Domain restriction, e.g. `yourcompany.com` |
| `USE_MOCK_DATA` | — | `true` uses fixture data, no GCP calls. Default: `false` |
| `GCP_PROJECTS` | ✅** | Comma-separated GCP project IDs to scan |
| `GCP_SERVICE_ACCOUNT_KEY` | ✅** | Base64-encoded service account JSON key |
| `GCP_ORG_ID` | — | GCP org ID — when set, all projects in the org are enumerated automatically |
| `POSTGRES_URL` | ✅ | Any PostgreSQL connection string |

\* At least one of `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` is required (not needed when `DEMO_MODE=true`).
\** Required when `USE_MOCK_DATA=false`.
\*** Not required when `DEMO_MODE=true`.

> **No AI API key is needed in the environment.** Each user adds their own key (Gemini, Claude, or OpenAI) through the in-app Settings page. Keys are encrypted at rest.

---

## Demo Deployment

The demo deployment uses fixture data and auto-signs in visitors — no Google OAuth or GCP credentials are needed.

### Minimum env vars for demo (Vercel)

```
AUTH_SECRET=<openssl rand -base64 32>
DEMO_MODE=true
USE_MOCK_DATA=true
POSTGRES_URL=<neon or any postgres>
```

`POSTGRES_URL` is used to store compliance risk acceptances and score history so demo visitors get a full experience. Use a [Neon](https://neon.tech) free-tier database.

### Vercel demo setup

1. Create a **new Vercel project** from the same repo (separate from your production project).
2. In **Settings → Environment Variables**, add only the four vars above.
3. Provision a Postgres database via **Storage → Create Database** and connect it (auto-injects `POSTGRES_URL`).
4. Run the migration once: `psql $POSTGRES_URL < scripts/migrate.sql`
5. Deploy — visitors land on a login page with an **Enter Demo** button and are immediately signed in as `demo@watchmen.dev`.

> The demo user is shared across all visitors. Risk acceptances and compliance suppressions made by one visitor are visible to others. This is intentional — it shows the feature in action. Reset the DB periodically if needed.

---

## GCP Setup

### 1. Create a service account

```bash
export PROJECT_ID=my-gcp-project

gcloud iam service-accounts create watchmen-reader \
  --display-name="Watchmen Reader" \
  --project=$PROJECT_ID

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

# Paste this value into GCP_SERVICE_ACCOUNT_KEY
base64 -i sa-key.json | tr -d '\n'

rm sa-key.json
```

### 3. (Optional) Org-wide scanning

```bash
gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.securityReviewer"
```

Then set `GCP_ORG_ID` in your environment. Watchmen will enumerate all projects automatically instead of reading from `GCP_PROJECTS`.

---

## Google OAuth Setup

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID** → **Web application**.
2. Add **Authorized redirect URIs** for every environment:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://your-domain.com/api/auth/callback/google`
3. Copy the **Client ID** and **Client Secret** into your environment.
4. On the **OAuth consent screen** ensure the `cloud-platform` scope is approved, or GCP scans will return 403 errors.

---

## Database Setup

Run once before starting the app:

```bash
psql $POSTGRES_URL < scripts/migrate.sql
```

**Supported databases:**

| Option | Connection string format |
|---|---|
| Vercel Postgres (Neon) | Auto-injected when using Vercel Storage |
| Neon (standalone) | `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require` |
| GCP Cloud SQL | `postgresql://user:pass@/db?host=/cloudsql/project:region:instance` |
| Self-hosted | `postgresql://user:pass@host:5432/watchmen` |

---

## Access Control

| Variable | Example | Behaviour |
|---|---|---|
| `ALLOWED_EMAILS` | `alice@corp.com,bob@corp.com` | Allowlist specific accounts |
| `ALLOWED_DOMAIN` | `corp.com` | Allow everyone with a `@corp.com` Google account |

Both can be set simultaneously (union of both lists). Users not on the list are redirected to the login page.

---

## Vercel

```bash
npx vercel
```

Or connect the GitHub repo in the [Vercel dashboard](https://vercel.com/new) for automatic deploys on push to `main`.

**Checklist:**
1. Framework preset: **Next.js** — auto-detected.
2. Add all env vars in **Settings → Environment Variables**.
3. Provision a database via **Storage → Create Database** (Postgres). `POSTGRES_URL` is injected automatically.
4. Run the migration from your local machine: `psql $POSTGRES_URL < scripts/migrate.sql`
5. Add `https://your-app.vercel.app/api/auth/callback/google` to Google OAuth redirect URIs.

---

## GCP Cloud Run

### Prerequisites

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### Option A — Deploy from source (no Docker needed locally)

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
GCP_PROJECTS=watchmen-gcp-projects:latest,\
GCP_SERVICE_ACCOUNT_KEY=watchmen-sa-key:latest,\
POSTGRES_URL=watchmen-postgres-url:latest
```

Store secrets in GCP Secret Manager first:

```bash
echo -n "my-secret-value" | gcloud secrets create watchmen-auth-secret --data-file=-
# repeat for each secret
```

### Option B — Deploy a pre-built image from GHCR

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

### Cloud SQL (private connection)

```
POSTGRES_URL=postgresql://USER:PASS@/DBNAME?host=/cloudsql/PROJECT:REGION:INSTANCE
```

```bash
# Grant the Cloud Run service account access to Cloud SQL
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

Add `--add-cloudsql-instances=PROJECT:REGION:INSTANCE` to the deploy command.

### Custom domain

```bash
gcloud run domain-mappings create \
  --service watchmen \
  --domain watchmen.example.com \
  --region us-central1
```

Follow the DNS instructions printed, then add `https://watchmen.example.com/api/auth/callback/google` to your OAuth redirect URIs.

---

## Kubernetes

All manifests are in `k8s/`. Apply with kustomize or individually.

### Prerequisites

```bash
# nginx ingress controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace

# cert-manager (Let's Encrypt TLS)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace --set installCRDs=true

# ClusterIssuer — replace the email address
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
  --from-literal=USE_MOCK_DATA="false" \
  --from-literal=GCP_PROJECTS="project-a,project-b" \
  --from-literal=GCP_SERVICE_ACCOUNT_KEY="$(base64 -i sa-key.json | tr -d '\n')" \
  --from-literal=POSTGRES_URL="postgresql://user:pass@host:5432/watchmen" \
  -n watchmen
```

### Step 3 — Update the image and domain

In `k8s/deployment.yaml`, replace `YOUR_GITHUB_ORG`:
```yaml
image: ghcr.io/YOUR_GITHUB_ORG/watchmen:main
```

In `k8s/ingress.yaml`, replace both occurrences of `watchmen.example.com`.

### Step 4 — Apply

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### Step 5 — Verify

```bash
kubectl get pods -n watchmen -w
kubectl rollout status deployment/watchmen -n watchmen
kubectl logs -n watchmen -l app=watchmen -f
kubectl get ingress -n watchmen   # TLS cert takes ~60s
```

### Pulling from a private GHCR package

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT \
  -n watchmen
```

Uncomment `imagePullSecrets` in `k8s/deployment.yaml`.

### Rolling update

```bash
kubectl set image deployment/watchmen \
  watchmen=ghcr.io/YOUR_ORG/watchmen:sha-<NEW_SHA> \
  -n watchmen
kubectl rollout status deployment/watchmen -n watchmen
```

---

## GitHub Actions CI/CD

Two workflows ship in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push / PR to `main` | TypeScript check + ESLint |
| `docker.yml` | Push to `main`, semver tags | Multi-platform build, push to GHCR |

### Image tags

| Git event | Tags produced |
|---|---|
| Push to `main` | `:main`, `:sha-abc1234` |
| Tag `v1.2.3` | `:1.2.3`, `:1.2`, `:1`, `:latest`, `:sha-abc1234` |
| Pull request | Build only — not pushed |

No extra secrets are required. `GITHUB_TOKEN` is used automatically with `packages: write` permission.

To make the GHCR package public: GitHub → repo → **Packages** → `watchmen` → **Package settings** → **Make public**.

---

## Local Development

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local (see Environment Variables above)

# Optional: spin up a local Postgres
docker run -d --name watchmen-pg \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=watchmen \
  -p 5432:5432 postgres:16-alpine
psql postgresql://postgres:dev@localhost:5432/watchmen < scripts/migrate.sql

npm run dev      # http://localhost:3000
```

### Mock mode (no GCP credentials needed)

Set `USE_MOCK_DATA=true` in `.env.local`. The app uses fixture data from `fixtures/` for all GCP resources.

### Useful commands

```bash
npm run dev          # dev server with hot reload
npm run build        # production build
npm run start        # serve production build
npm run type-check   # TypeScript — no emit
npm run lint         # ESLint

# Build and run with Docker
docker build -t watchmen:dev .
docker run --rm -p 3000:3000 --env-file .env.local watchmen:dev
```
