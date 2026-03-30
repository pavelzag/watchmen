# Watchmen — Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Database Setup](#database-setup)
4. [Google OAuth Setup](#google-oauth-setup)
5. [GCP Setup](#gcp-setup)
6. [AWS Setup](#aws-setup)
7. [Access Control](#access-control)
8. [Vercel](#vercel)
9. [GCP Cloud Run](#gcp-cloud-run)
10. [Kubernetes — Full Stack](#kubernetes--full-stack)
11. [Demo Deployment](#demo-deployment)
12. [GitHub Actions CI/CD](#github-actions-cicd)
13. [Local Development](#local-development)

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | App runtime |
| npm | ≥ 10 | Package manager |
| Docker | any recent | Container builds |
| PostgreSQL | ≥ 14 | Required for all non-demo deployments |
| gcloud CLI | latest | GCP setup and Cloud Run deploys |
| kubectl | ≥ 1.28 | Kubernetes deployments |
| helm | ≥ 3.12 | Installing ingress controller and cert-manager |
| go | ≥ 1.22 | Only if building the processor service locally |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | ✅ | Random secret for NextAuth. Generate: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | ✅* | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅* | Google OAuth 2.0 client secret |
| `ALLOWED_EMAILS` | ✅** | Comma-separated list of allowed email addresses |
| `ALLOWED_DOMAIN` | ✅** | Domain restriction, e.g. `yourcompany.com` |
| `POSTGRES_URL` | ✅ | PostgreSQL connection string |
| `USE_MOCK_DATA` | — | `true` → use fixture data, no GCP API calls |
| `GCP_PROJECTS` | — | Comma-separated GCP project IDs to scan |
| `GCP_SERVICE_ACCOUNT_KEY` | — | Base64-encoded service account JSON key |
| `GCP_ORG_ID` | — | GCP org ID — auto-enumerates all projects in the org |
| `DEMO_MODE` | — | `true` → one-click demo sign-in, fixture data, no OAuth needed |
| `PROCESSOR_URL` | — | Internal processor service URL (Kubernetes only) |
| `GOOGLE_CLOUD_PROJECT` | — | GCP project for Cloud Trace (Kubernetes only) |

\* Not required when `DEMO_MODE=true`.
\** At least one of `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` is required (not needed when `DEMO_MODE=true`).

> **No AI API key is required at the server level.** Each user adds their own Gemini, Claude, or OpenAI key through **Settings → AI Keys**. Keys are AES-256-GCM encrypted in the database.
>
> **AWS credentials are also per-user.** Users add their AWS access key via **Settings → Cloud Credentials**. No `AWS_*` env vars are needed on the server.

---

## Database Setup

Run once before the first start:

```bash
psql $POSTGRES_URL < scripts/migrate.sql
```

**Supported databases:**

| Option | Connection string |
|---|---|
| Vercel Postgres (Neon) | Auto-injected when using Vercel Storage |
| Neon (standalone) | `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require` |
| GCP Cloud SQL (private) | `postgresql://user:pass@/db?host=/cloudsql/project:region:instance` |
| Self-hosted | `postgresql://user:pass@host:5432/watchmen` |

---

## Google OAuth Setup

1. Open [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID → Web application**.
2. Add **Authorized redirect URIs** for every environment you plan to use:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://your-domain.com/api/auth/callback/google`
3. Copy the **Client ID** and **Client Secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. On the **OAuth consent screen**, ensure the `https://www.googleapis.com/auth/cloud-platform` scope is listed. Without it, GCP scans return 403 errors when users sign in with their own Google account (not needed when using a service account key).

---

## GCP Setup

Watchmen needs read-only access to the GCP resources it scans. The recommended approach is a dedicated service account.

### 1. Create the service account

```bash
export PROJECT_ID=my-gcp-project

gcloud iam service-accounts create watchmen-reader \
  --display-name="Watchmen Reader" \
  --project=$PROJECT_ID
```

### 2. Assign read-only roles

```bash
for role in \
  roles/iam.securityReviewer \
  roles/storage.objectViewer \
  roles/container.viewer \
  roles/cloudsql.viewer \
  roles/run.viewer \
  roles/bigquery.metadataViewer \
  roles/pubsub.viewer \
  roles/secretmanager.viewer \
  roles/compute.networkViewer \
  roles/logging.viewer; do
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
      --role="$role"
done
```

The `logging.viewer` role is required for the live log viewer and AI log analysis features.

### 3. Export and encode the key

```bash
gcloud iam service-accounts keys create sa-key.json \
  --iam-account="watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com"

# Copy this value into GCP_SERVICE_ACCOUNT_KEY
base64 -i sa-key.json | tr -d '\n'

# Delete the local key file — the base64 value is all you need
rm sa-key.json
```

### 4. (Optional) Org-wide scanning

To scan all projects in an organization automatically instead of listing them in `GCP_PROJECTS`:

```bash
gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.securityReviewer"
```

Set `GCP_ORG_ID=YOUR_ORG_ID` in your environment. Watchmen will call the Resource Manager API to enumerate all projects automatically.

### 5. Per-user GCP credentials (alternative to service account key)

Users can also connect their own GCP account via **Settings → Cloud Credentials → GCP → Connect with Google**. This uses the OAuth access token from their Google sign-in with the `cloud-platform` scope. No service account key is required for this flow.

---

## AWS Setup

AWS credentials are configured **per user** in the Watchmen UI, not as server environment variables. Each user provides their own IAM access key through **Settings → Cloud Credentials → AWS**.

### Creating a least-privilege IAM user for scanning

The recommended approach for each person scanning AWS resources:

#### Step 1 — Create a dedicated IAM user

```
AWS Console → IAM → Users → Create user
User name: watchmen-scanner
```

#### Step 2 — Attach a permissions policy

**Option A — AWS managed policy (simplest)**

Attach `ReadOnlyAccess`. This grants broad read-only access to all services.

**Option B — Custom least-privilege policy (recommended)**

Create a custom policy with exactly the permissions Watchmen needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WatchmenReadOnly",
      "Effect": "Allow",
      "Action": [
        "iam:ListUsers",
        "iam:ListRoles",
        "iam:ListAccessKeys",
        "iam:ListAttachedUserPolicies",
        "iam:ListAttachedRolePolicies",
        "iam:GetUser",
        "iam:GetRole",
        "iam:GetLoginProfile",
        "iam:ListMFADevices",
        "iam:ListUserPolicies",
        "iam:GetUserPolicy",
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeRegions",
        "ec2:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTargetGroups",
        "eks:ListClusters",
        "eks:DescribeCluster",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "lambda:ListFunctions",
        "lambda:GetPolicy",
        "s3:ListAllMyBuckets",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketPolicy",
        "s3:GetBucketAcl",
        "s3:GetBucketLocation",
        "sns:ListTopics",
        "sns:GetTopicAttributes",
        "secretsmanager:ListSecrets",
        "redshift:DescribeClusters",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Step 3 — Create an access key

```
IAM → Users → watchmen-scanner → Security credentials → Create access key
Purpose: Third-party service
```

Download the **Access Key ID** and **Secret Access Key** — you will not be able to view the secret again.

#### Step 4 — Add the credentials in Watchmen

1. Go to **Settings → Cloud Credentials → AWS**.
2. Enter the **Access Key ID**, **Secret Access Key**, and **Default Region** (e.g. `us-east-1`).
3. Click **Save**. Watchmen will verify the credentials with a `sts:GetCallerIdentity` call and immediately run a background scan.

To scan multiple regions, set a comma-separated list of regions in the region field (e.g. `us-east-1,eu-west-1,ap-southeast-1`).

---

## Access Control

| Variable | Example | Behaviour |
|---|---|---|
| `ALLOWED_EMAILS` | `alice@corp.com,bob@corp.com` | Allow specific accounts |
| `ALLOWED_DOMAIN` | `corp.com` | Allow all `@corp.com` Google accounts |

Both can be set simultaneously — access is granted if either condition matches. Users not on the list are redirected to the sign-in page with an "Access denied" message.

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

### Option A — Deploy from source (no Docker required locally)

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

### Option B — Deploy a pre-built image

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
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

Add `--add-cloudsql-instances=PROJECT:REGION:INSTANCE` to the deploy command.

---

## Kubernetes — Full Stack

The full Kubernetes deployment runs three workloads:

| Workload | Purpose |
|---|---|
| `watchmen` | Next.js web application |
| `watchmen-processor` | Go service that traces in-cluster HTTP requests and reports back to the topology graph |
| `wm-echo` (optional) | Lightweight test echo app for live-trace demos |

All manifests live in `k8s/`. Istio is optional but recommended for the live request-tracing feature.

---

### Step 0 — Cluster prerequisites

Install the nginx ingress controller and cert-manager for TLS:

```bash
# Nginx ingress controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# cert-manager (Let's Encrypt)
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# Wait for cert-manager pods to be ready
kubectl rollout status deployment/cert-manager -n cert-manager
```

Create a ClusterIssuer for Let's Encrypt (replace the email address):

```bash
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

---

### Step 1 — Run the database migration

```bash
psql $POSTGRES_URL < scripts/migrate.sql
```

---

### Step 2 — Create the namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

---

### Step 3 — Create the environment secret

Populate the `watchmen-env` secret with your configuration:

```bash
kubectl create secret generic watchmen-env \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  --from-literal=GOOGLE_CLIENT_SECRET="your-client-secret" \
  --from-literal=ALLOWED_EMAILS="admin@example.com" \
  --from-literal=POSTGRES_URL="postgresql://user:pass@host:5432/watchmen" \
  --from-literal=GCP_PROJECTS="project-a,project-b" \
  --from-literal=GCP_SERVICE_ACCOUNT_KEY="$(base64 -i sa-key.json | tr -d '\n')" \
  --from-literal=GOOGLE_CLOUD_PROJECT="your-gcp-project-id" \
  --from-literal=USE_MOCK_DATA="false" \
  -n watchmen
```

> If you are scanning GCP via user OAuth (not a service account key), omit `GCP_SERVICE_ACCOUNT_KEY`. Users will connect their own GCP account from the Settings page.
>
> AWS credentials are **not** in this secret — they are provided per-user through the UI.

---

### Step 4 — Build and push images

Replace `YOUR_REGISTRY` with your container registry (GCR, GHCR, Docker Hub, etc.).

```bash
# Main web application
docker build -t YOUR_REGISTRY/watchmen:latest .
docker push YOUR_REGISTRY/watchmen:latest

# Request processor (Go service)
docker build -t YOUR_REGISTRY/watchmen-processor:latest \
  -f services/request-processor/Dockerfile services/request-processor/
docker push YOUR_REGISTRY/watchmen-processor:latest

# (Optional) Test echo app for live-trace demos
docker build -t YOUR_REGISTRY/wm-echo:latest \
  -f services/test-echo/Dockerfile services/test-echo/
docker push YOUR_REGISTRY/wm-echo:latest
```

Update the image references in the manifests:

```bash
# In k8s/deployment.yaml
sed -i 's|gcr.io/watchmen-test-488807/watchmen:latest|YOUR_REGISTRY/watchmen:latest|' k8s/deployment.yaml

# In k8s/processor-deployment.yaml
sed -i 's|gcr.io/watchmen-test-488807/watchmen-processor:latest|YOUR_REGISTRY/watchmen-processor:latest|' k8s/processor-deployment.yaml
```

---

### Step 5 — Deploy the main application

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

Verify the pod is running:

```bash
kubectl get pods -n watchmen -w
# wait until STATUS is Running

kubectl logs -n watchmen -l app=watchmen --tail=50
```

---

### Step 6 — Deploy the request processor

The processor service traces in-cluster HTTP requests. It is optional but required for the live topology graph to show real traffic.

```bash
kubectl apply -f k8s/processor-deployment.yaml
```

The processor is reached by the main app via `PROCESSOR_URL=http://watchmen-processor.watchmen.svc.cluster.local` (already set in `k8s/deployment.yaml`).

Verify:

```bash
kubectl get pods -n watchmen -l app=watchmen-processor
kubectl logs -n watchmen -l app=watchmen-processor --tail=20
```

---

### Step 7 — (Optional) Deploy the test echo app

The echo app is a lightweight HTTP server useful for observing live traffic in the topology graph.

```bash
kubectl apply -f k8s/test-app/nginx-config.yaml
kubectl apply -f k8s/test-app/deployment.yaml
kubectl apply -f k8s/test-app/service.yaml
```

---

### Step 8 — Configure the ingress

Edit `k8s/ingress.yaml` and replace both occurrences of `watchmen.example.com` with your actual domain:

```bash
sed -i 's/watchmen.example.com/watchmen.yourdomain.com/g' k8s/ingress.yaml
kubectl apply -f k8s/ingress.yaml
```

Point your domain's DNS A record to the ingress controller's external IP:

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

TLS certificate issuance takes about 60 seconds after DNS propagates:

```bash
kubectl get certificate -n watchmen -w
# wait for READY = True
```

---

### Step 9 — (Optional) Istio service mesh

Istio enables mutual TLS between pods and provides Envoy access logs for the live traffic visualisation in the Request Tracer page.

**Install Istio:**

```bash
# Download and install istioctl
curl -L https://istio.io/downloadIstio | sh -
export PATH="$PATH:$(pwd)/istio-*/bin"

# Install with the default profile
istioctl install --set profile=default -y

# Verify
kubectl get pods -n istio-system
```

**Enable sidecar injection for the watchmen namespace:**

```bash
kubectl apply -f k8s/istio/namespace-label.yaml
```

This labels the namespace with `istio-injection=enabled`. All pods created after this point will automatically receive an Envoy sidecar.

**Restart existing pods to inject sidecars:**

```bash
kubectl rollout restart deployment/watchmen -n watchmen
kubectl rollout restart deployment/watchmen-processor -n watchmen
```

**Apply Istio telemetry and security policies:**

```bash
# Enable Envoy JSON access logs (collected by Cloud Logging)
kubectl apply -f k8s/istio/telemetry.yaml

# Enable mTLS (PERMISSIVE mode — allows traffic from non-injected pods during rollout)
kubectl apply -f k8s/istio/peer-authentication.yaml
```

After all pods have sidecars, tighten to STRICT mode:

```bash
kubectl patch peerauthentication default -n watchmen \
  --type=merge -p '{"spec":{"mtls":{"mode":"STRICT"}}}'
```

**Verify sidecar injection:**

```bash
kubectl get pods -n watchmen
# Each pod should show 2/2 containers (app + istio-proxy)
```

Once Istio is running, the Request Tracer page will display `istio-proxy` and `nginx` in the topology graph alongside your application containers, and the live pulse animation will fire on real incoming requests.

---

### Step 10 — Verify the full deployment

```bash
# All pods running
kubectl get pods -n watchmen

# Rollout complete
kubectl rollout status deployment/watchmen -n watchmen
kubectl rollout status deployment/watchmen-processor -n watchmen

# Ingress and TLS
kubectl get ingress -n watchmen
kubectl get certificate -n watchmen

# Tail live logs
kubectl logs -n watchmen -l app=watchmen -f
```

Open `https://watchmen.yourdomain.com`, sign in, and run a GCP scan from the dashboard.

---

### Pulling from a private registry

```bash
# GHCR example
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT \
  -n watchmen
```

Uncomment the `imagePullSecrets` block in `k8s/deployment.yaml` and `k8s/processor-deployment.yaml`.

---

### Rolling update

```bash
kubectl set image deployment/watchmen \
  watchmen=YOUR_REGISTRY/watchmen:sha-<NEW_SHA> \
  -n watchmen
kubectl rollout status deployment/watchmen -n watchmen
```

---

### Scaling

```bash
# Scale web app to 3 replicas
kubectl scale deployment/watchmen --replicas=3 -n watchmen

# Check pod distribution
kubectl get pods -n watchmen -o wide
```

The processor service is stateless and can be scaled independently:

```bash
kubectl scale deployment/watchmen-processor --replicas=2 -n watchmen
```

---

## Demo Deployment

The demo mode uses fixture data and auto-signs in visitors — no Google OAuth, GCP credentials, or AWS credentials are needed.

**Minimum environment variables:**

```
AUTH_SECRET=<openssl rand -base64 32>
DEMO_MODE=true
USE_MOCK_DATA=true
POSTGRES_URL=<neon or any postgres url>
```

**Vercel setup:**

1. Create a new Vercel project from the repo.
2. Add the four vars above in **Settings → Environment Variables**.
3. Provision a Postgres database via **Storage → Create Database** and connect it.
4. Run the migration: `psql $POSTGRES_URL < scripts/migrate.sql`
5. Deploy — visitors see an **Enter Demo** button and are signed in as `demo@watchmen.dev`.

---

## GitHub Actions CI/CD

Two workflows ship in `.github/workflows/`:

| Workflow | Trigger | Action |
|---|---|---|
| `ci.yml` | Push / PR to `main` | TypeScript check + ESLint |
| `docker.yml` | Push to `main`, semver tags | Multi-platform build, push to GHCR |

**Image tags produced:**

| Git event | Tags |
|---|---|
| Push to `main` | `:main`, `:sha-abc1234` |
| Tag `v1.2.3` | `:1.2.3`, `:1.2`, `:1`, `:latest`, `:sha-abc1234` |
| Pull request | Build only — not pushed |

`GITHUB_TOKEN` is used automatically with `packages: write` permission. No extra secrets required.

To make the GHCR package public: GitHub repo → **Packages → watchmen → Package settings → Make public**.

---

## Local Development

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local — minimum values listed inside

# Optional: local Postgres
docker run -d --name watchmen-pg \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=watchmen \
  -p 5432:5432 postgres:16-alpine

psql postgresql://postgres:dev@localhost:5432/watchmen < scripts/migrate.sql

npm run dev      # → http://localhost:3000
```

### Mock mode (no GCP credentials needed)

Set `USE_MOCK_DATA=true` in `.env.local`. The app uses fixture data from `fixtures/` for all GCP resources. AWS mock data is enabled automatically when `USE_MOCK_DATA=true`.

### Useful commands

```bash
npm run dev          # Dev server with hot reload
npm run build        # Production build
npm run start        # Serve the production build
npm run type-check   # TypeScript — no emit
npm run lint         # ESLint

# Build and run with Docker
docker build -t watchmen:dev .
docker run --rm -p 3000:3000 --env-file .env.local watchmen:dev
```
