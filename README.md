# Watchmen — GCP IAM Explorer

Query your GCP IAM permissions using natural language. Powered by Claude AI.

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local — set USE_MOCK_DATA=true to start without GCP credentials
npm run dev
```

Open http://localhost:3000 and sign in with Google.

## Environment Variables

See `.env.local.example` for all required variables.

**Minimum to run locally (mock mode):**
```
AUTH_SECRET=any_random_string
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ANTHROPIC_API_KEY=sk-ant-...
USE_MOCK_DATA=true
ALLOWED_EMAILS=you@gmail.com
```

## GCP Setup (when ready for real data)

1. Run the test environment setup script:
   ```bash
   bash scripts/setup-gcp-test.sh
   ```
2. Generate and encode the service account key:
   ```bash
   gcloud iam service-accounts keys create key.json \
     --iam-account=watchmen-reader@YOUR_PROJECT.iam.gserviceaccount.com
   base64 -i key.json | tr -d '\n'
   ```
3. Set `GCP_SERVICE_ACCOUNT_KEY`, `GCP_PROJECTS`, and `USE_MOCK_DATA=false` in `.env.local`

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-app.vercel.app/api/auth/callback/google` (production)

## Deploy to Vercel

```bash
npx vercel
```

Add all environment variables in Vercel dashboard → Settings → Environment Variables.
Change `ALLOWED_EMAILS` or `ALLOWED_DOMAIN` to restrict access.

## Mock Data

Fixture files in `/fixtures/` simulate:
- 3 GCP projects with IAM bindings
- 4 service accounts
- 3 Cloud Storage buckets
- 3 GKE clusters
- 5 users (zagalsky@gmail.com, alice@acme.com, bob@acme.com, carol@acme.com)

## Architecture

```
User Query → Claude (intent extraction) → GCP APIs → Claude (response formatting) → UI
```

Toggle between real GCP and mock data: `USE_MOCK_DATA=true|false`
