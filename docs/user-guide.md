# Watchmen — User Guide

## Table of Contents

1. [What Watchmen does](#what-watchmen-does)
2. [Signing in](#signing-in)
3. [First-time setup: add an AI key](#first-time-setup-add-an-ai-key)
4. [Scanning your GCP environment](#scanning-your-gcp-environment)
5. [Natural language queries](#natural-language-queries)
6. [Security findings](#security-findings)
7. [Compliance](#compliance)
8. [Principal overview](#principal-overview)
9. [Snapshot history](#snapshot-history)
10. [Resource pages](#resource-pages)

---

## What Watchmen does

Watchmen scans your GCP organisation and lets you:

- Ask questions about your infrastructure in plain English (*"Which buckets are public?"*, *"Who has owner access on project X?"*)
- See a prioritised list of security findings across all your projects
- Run SOC 2 Type II and ISO 27001:2022 compliance checks and track your score over time
- Accept risk on individual compliance controls with a written justification
- Browse all IAM bindings, service accounts, clusters, databases, firewall rules, and more in one place

---

## Signing in

Go to your Watchmen URL and click **Sign in with Google**. You must use a Google account that your administrator has allow-listed (by email address or by domain).

If you see *"Access denied"*, contact whoever deployed Watchmen and ask them to add your email to `ALLOWED_EMAILS` or your domain to `ALLOWED_DOMAIN`.

---

## First-time setup: add an AI key

Watchmen uses AI for two things:
- **Natural language query parsing** — understanding what you're asking
- **AI remediation recommendations** — per-control advice on the Compliance page

You must add your own API key before either of these features will work. Your key is encrypted before being stored and is never shared with other users.

### Step 1 — Go to Settings

Click your profile avatar (top-right) → **Settings**, or navigate to `/dashboard/settings`.

### Step 2 — Add a key

Click **Add API Key** and choose your provider:

| Provider | Where to get a key | Key format |
|---|---|---|
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `AIza…` |
| **Anthropic Claude** | [console.anthropic.com](https://console.anthropic.com) → API Keys | `sk-ant-…` |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `sk-…` |

Paste the key, click **Save**. Watchmen validates the key against the live API before saving it — you'll see an error if the key is invalid or has no credits.

### Step 3 — Set as active

If you add more than one key, click **Set Active** next to the one you want to use. Only the active key is used for AI calls.

> You can switch providers at any time by adding a new key and setting it as active.

---

## Scanning your GCP environment

After signing in, Watchmen automatically triggers a scan of your GCP projects using your Google OAuth token. The first scan may take 20–60 seconds depending on how many projects you have access to.

The dashboard shows a **last scanned** timestamp and automatically refreshes every 10 minutes. To trigger a manual re-scan, click **Sync GCP** on the dashboard.

The scan covers:
- IAM bindings across all projects
- Service accounts and their keys
- GKE clusters (version, Workload Identity, private nodes)
- Cloud SQL instances (public IP, backup, SSL)
- Cloud Run services and their IAM policies
- Storage buckets (IAM, versioning)
- BigQuery datasets
- Pub/Sub topics
- Secret Manager secrets
- VMs (external IPs)
- VPC firewall rules

---

## Natural language queries

The **Query** box on the dashboard lets you ask questions in plain English. Examples:

| Question | What it returns |
|---|---|
| *"What can alice@corp.com access?"* | All IAM roles for that user across projects, buckets, clusters, etc. |
| *"Who has owner access on project-x?"* | All principals with `roles/owner` on that project |
| *"List all public buckets"* | Buckets with `allUsers` or `allAuthenticatedUsers` in their IAM policy |
| *"Show me all firewall rules"* | Full list of VPC firewall rules with direction and port info |
| *"Which service accounts have stale keys?"* | SAs with user-managed keys older than 90 days |
| *"What are the security issues?"* | Summary of all findings (public resources, open firewalls, etc.) |
| *"Give me an overview of bob@corp.com"* | Complete access summary for a principal across all resource types |

Results appear as a formatted answer with **clickable resource chips** that link directly to the relevant resource page.

Your last 20 queries are saved locally and accessible via the history icon next to the query box.

> **Tip:** Queries use two AI calls — one to parse your intent, one to answer. If you get an unexpected result, try rephrasing with the project ID or resource name.

---

## Security findings

Navigate to **Findings** from the top navbar to see all security issues detected across your GCP environment.

Findings are grouped by severity:

| Severity | Examples |
|---|---|
| **Critical** | Public storage buckets, firewall rules open to `0.0.0.0/0`, SSH/RDP exposed to internet |
| **High** | Service accounts with owner/editor roles, secrets accessible to `allUsers` |
| **Medium** | Cloud SQL with public IP, disabled SAs still in IAM, unauthenticated Cloud Run |
| **Low** | VMs with external IPs |

Each finding card shows:
- The affected resource name and project
- A remediation hint
- A link to the relevant resource page

---

## Compliance

Navigate to **Compliance** from the top navbar.

### Switching standards

Use the **SOC 2 / ISO 27001** tabs to switch between frameworks. Both run independently against the same GCP snapshot.

### Reading the score

The **score ring** shows your overall compliance score (0–100):
- **≥ 80** — green (good standing)
- **60–79** — amber (attention needed)
- **< 60** — red (significant gaps)

The score chart below the ring shows how your score has changed over time.

### Control statuses

| Badge | Meaning |
|---|---|
| **PASS** | Control is satisfied |
| **WARN** | Potential issue — review recommended (counts as 0.5 in scoring) |
| **FAIL** | Control is violated — action required |
| **SUPPRESSED** | Risk accepted by you with a written justification |

### Filtering controls

Use the **All / Failing / Warnings / Suppressed** filter buttons to focus on what needs attention.

### AI remediation

Each non-passing control has an **Ask AI** button. Click it to get a detailed remediation guide with:
- Why this fails the standard
- Step-by-step `gcloud` commands to fix it
- How to prevent recurrence
- What evidence to collect for an auditor

> AI recommendations require an active AI key in Settings.

### Accepting risk

If a control is failing but you have a business reason to accept the risk (e.g., an exception documented in your risk register), click **Accept risk** on that control. Enter a justification and click **Confirm**.

- The control will show as **SUPPRESSED** with your justification text.
- Suppressed controls count as passing in the score calculation.
- Click **Revoke suppression** at any time to remove it.

### Per-project breakdown

The **Violations by Project** bar chart at the bottom of the page shows which GCP projects have the most compliance violations, helping you prioritise remediation.

### Exporting

- **Export CSV** — downloads all controls with their status, evidence, and remediation hints.
- **Export PDF** — triggers your browser's print dialog. All categories are fully expanded and all controls are shown regardless of the current filter — so what you see in the PDF matches the full report.

---

## Principal overview

Navigate to **Principal** from the top navbar and type any user email or service account email to see a complete access summary:

- All IAM roles across every project
- Access to buckets, GKE clusters, Cloud Run services, BigQuery datasets, secrets
- Service account metadata (keys, disabled state, roles)

This is useful for access reviews and offboarding — see exactly what a person or SA has access to in one view.

---

## Snapshot history

Navigate to **History** from the top navbar to compare two snapshots and see what changed between scans:

- New resources added
- Resources removed
- IAM policy changes (roles added or removed)

Use this after infrastructure changes or incidents to understand what changed and when.

---

## Resource pages

Each GCP resource type has a dedicated page accessible from the left sidebar or from the **Compliance** / **Findings** evidence chips:

| Page | What you see |
|---|---|
| Users | All human users and their project-level roles |
| Service Accounts | All SAs, their keys, roles, and disabled state |
| Buckets | Storage buckets, IAM policies, location, versioning |
| GKE Clusters | Cluster version, node count, Workload Identity, private nodes |
| VMs | Machine type, zone, external IP, service account |
| Cloud Run | Services, regions, service accounts, public access |
| Cloud SQL | Instances, public IP, backup status, SSL |
| BigQuery | Dataset IAM policies |
| Pub/Sub | Topic IAM policies |
| Secrets | Secret Manager secrets and their IAM policies |
| Firewall | VPC firewall rules, directions, source ranges |

All pages support a **search bar** that filters by resource name — compliance evidence chips link directly to the relevant page with the resource pre-searched.
