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
11. [Attack path analysis](#attack-path-analysis)
12. [GitHub PR remediation](#github-pr-remediation)
    - [Prerequisites](#prerequisites-1)
    - [The flow](#the-flow)
    - [New-file generation fallback](#new-file-generation-fallback)

---

## What Watchmen does

Watchmen scans your GCP organisation and lets you:

- Ask questions about your infrastructure in plain English (*"Which buckets are public?"*, *"Who has owner access on project X?"*)
- See a prioritised list of security findings across all your projects
- Visualise multi-step attack chains that correlate misconfigurations into exploitable paths (Attack Path Analysis)
- Automatically generate and open GitHub PRs that fix Terraform misconfigurations identified in attack paths
- Run SOC 2 Type II and ISO 27001:2022 compliance checks and track your score over time
- Accept risk on individual compliance controls with a written justification
- Browse all IAM bindings, service accounts, clusters, databases, firewall rules, and more in one place

---

## Signing in

Go to your Watchmen URL and click **Sign in with Google**. You must use a Google account that your administrator has allow-listed (by email address or by domain).

If you see *"Access denied"*, contact whoever deployed Watchmen and ask them to add your email to `ALLOWED_EMAILS` or your domain to `ALLOWED_DOMAIN`.

---

## First-time setup: add an AI key

Watchmen uses AI for three things:
- **Natural language query parsing** — understanding what you're asking
- **AI remediation recommendations** — per-control advice on the Compliance page
- **GitHub PR remediation** — generating Terraform fixes for detected attack paths

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

> **Shortcut:** Press **`/`** from anywhere in the dashboard to instantly jump to the query box — no mouse required.

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

### Keyboard shortcuts

| Key | Action |
|---|---|
| **`/`** | Focus the query box from anywhere on the page |
| **`Enter`** | Submit the query |
| **`Shift + Enter`** | New line (multi-line queries) |

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

---

## Attack path analysis

Navigate to **Attack Paths** from the top navbar (or go directly to `/dashboard/attack-paths`) to see multi-step attack chains derived from your current GCP snapshot.

Unlike the Findings page — which surfaces individual misconfigurations — Attack Paths correlates multiple findings into complete exploit chains, showing you how an attacker could move from an entry point through pivot resources to a high-value target.

### How it works

Attack Paths reads from the same GCP snapshot as the Findings page. No additional API calls are made. If the data looks stale, trigger a new scan from the Dashboard first (**Sync GCP**), then return to this page.

The engine (`lib/gcp/attack-paths.ts` → `computeAttackPaths()`) detects the following chain types:

| Chain | Severity | Condition |
|---|---|---|
| Internet → Open Firewall → VM → Privileged SA | CRITICAL / HIGH | Firewall rule with `0.0.0.0/0` source + VM with external IP running a privileged SA |
| Unauthenticated Cloud Run → Privileged SA | CRITICAL / HIGH | `allUsers` invoker on a Cloud Run service running a privileged SA |
| Public Writable Bucket → SA Privilege Escalation | CRITICAL | `allUsers` or `allAuthenticatedUsers` with write access + privileged SA in the same project |
| Public Readable Bucket → Direct Data Exposure | HIGH | `allUsers` read access on a bucket |
| Public Secret Manager Secret → Direct Credential Exposure | CRITICAL | `allUsers` or `allAuthenticatedUsers` on a secret |
| Single User Account → Lateral Movement | HIGH | One user with `owner` or `editor` on 2 or more projects |

### Reading a path card

Each card shows:
- **Node chain** — colour-coded **ENTRY → PIVOT → TARGET** badges representing the attack steps
- **Description** — a plain-English explanation of how the chain is exploitable
- **Mitigations** — specific remediation steps for each node in the chain

Click any card to expand it and see the full detail.

### Filtering

Use the **ALL / CRITICAL / HIGH** filter buttons at the top of the page to focus on the severity level you care about.

---

## GitHub PR remediation

When attack paths are present, a **Fix with GitHub PR** button appears on the Attack Paths page. Clicking it opens a guided flow that creates a pull request in your Terraform repository with AI-generated fixes for the selected paths.

### Prerequisites

**1. An active AI key** — This feature uses whichever AI provider you have set as active in **Settings → AI Keys** (Google Gemini, Anthropic Claude, or OpenAI). See [First-time setup: add an AI key](#first-time-setup-add-an-ai-key) if you haven't added one yet.

**2. A GitHub Personal Access Token** — Configure one in **Settings → Integrations**:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Grant the following permissions: **Contents** (read & write), **Pull requests** (read & write)
3. In Watchmen, go to **Settings → Integrations → GitHub**, paste the token, and click **Save**

Watchmen validates the token against the GitHub API before saving it. The token is AES-256-GCM encrypted before storage, the same as cloud credentials.

If Slack is configured in **Settings → Alerts**, a notification is sent to your Slack channel when the PR is created.

### The flow

| Step | What happens |
|---|---|
| **1 — Select paths** | Choose which attack paths to fix. All detected paths are pre-selected. |
| **2 — Select repo** | Pick the GitHub repository where your Terraform files live. The list is populated from your GitHub token. |
| **3 — Analyzing** | Watchmen scans all `.tf` files in the repo and uses your active AI key to identify which files contain the misconfigured resources and generate fixes. |
| **4 — Preview** | A before/after diff is shown for every file that will be modified (or the new file that will be created). Review the changes before committing. |
| **5 — Creating** | Changes are committed to a new branch (`watchmen-fix-<timestamp>`) and a pull request is opened. |
| **6 — Done** | The PR URL is shown with a direct link to GitHub. A Slack notification is sent if Slack is configured. |

### How the AI fix works

Watchmen extracts resource identifiers from each attack path node (bucket names, firewall names, Cloud Run service names, SA emails, secret names) and searches all `.tf` files in the repo for those strings. For each matching file, the AI generates a minimal fix that removes overly permissive IAM bindings, restricts `source_ranges`, or downgrades SA roles — without touching unrelated resources.

The AI call uses whichever provider you have active in Settings. All three supported providers (Google Gemini, Anthropic Claude, OpenAI) are fully supported.

### New-file generation fallback

If no existing `.tf` files in the repository contain identifiers matching the selected attack paths — or if the AI determines that the matched files need no changes — Watchmen automatically generates a **new** Terraform file (`watchmen-security-fixes.tf`) with resources that remediate the issues from scratch.

The generated file:
- Creates IAM bindings, firewall rules, and other GCP resources that enforce least-privilege
- Uses `watchmen-` as a resource name prefix to avoid collisions with your existing infrastructure
- Addresses every selected attack path

In the preview step, newly generated files are shown with a **NEW FILE** badge and all lines highlighted in green (since there is no prior version to diff against).

The PR commit message reflects the file origin:
- Modified existing file: `fix: remediate "..." in main.tf` _(original preserved as `main-faulty.tf`)_
- New generated file: `fix: generate watchmen-security-fixes.tf to remediate "..."`

### What the PR contains

- One commit per changed or created `.tf` file
- For modified files, the original is preserved alongside it (e.g. `main-faulty.tf`) for easy reference
- PR title: `fix(security): remediate N attack paths [Watchmen]`
- PR body listing each attack path fixed, the mitigations applied, and a review reminder
