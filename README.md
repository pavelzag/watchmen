# Watchmen — GCP IAM Explorer

Query your GCP infrastructure in plain English, detect security issues, and run SOC 2 / ISO 27001 compliance checks — all in one place.

## Docs

| Document | Description |
|---|---|
| [Deployment Guide](docs/deployment.md) | Environment variables, GCP setup, OAuth, database, Vercel, Cloud Run, Kubernetes, CI/CD |
| [User Guide](docs/user-guide.md) | Signing in, adding an AI key, queries, findings, compliance, risk acceptance |
| [Architecture](docs/architecture.md) | System design, component map, database schema, GCP resources scanned |

## Quick start (local mock mode)

```bash
git clone https://github.com/YOUR_ORG/watchmen.git
cd watchmen
npm install
cp .env.local.example .env.local
# Edit .env.local — minimum required values are listed inside
```

Spin up a local Postgres:

```bash
docker run -d --name watchmen-pg \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=watchmen \
  -p 5432:5432 postgres:16-alpine

psql postgresql://postgres:dev@localhost:5432/watchmen < scripts/migrate.sql
```

```bash
npm run dev   # http://localhost:3000
```

Sign in with Google, then go to **Settings → AI Keys** and add a Gemini, Claude, or OpenAI key to enable natural language queries and AI recommendations.

For full deployment instructions see [docs/deployment.md](docs/deployment.md).
