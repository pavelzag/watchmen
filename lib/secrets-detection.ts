/**
 * Secrets detection engine.
 * Scans environment variable key=value pairs for common secret patterns.
 * All detections are heuristic — intended to surface likely-leaked credentials
 * for human review, not as definitive proof.
 */

export interface SecretMatch {
  /** The environment variable key */
  key: string;
  /** Redacted value (first 4 chars + "…") */
  redactedValue: string;
  /** Human-readable description of the detected pattern */
  patternLabel: string;
  /** Confidence level */
  confidence: "high" | "medium";
}

// ─── Patterns ────────────────────────────────────────────────────────────────

// AWS access key ID
const RE_AWS_KEY_ID = /\bAKIA[0-9A-Z]{16}\b/;

// AWS secret access key (40 hex/base64 chars following likely key-name context)
const RE_AWS_SECRET = /[A-Za-z0-9+/]{40}/;

// GCP service account JSON fragment
const RE_GCP_SA_KEY = /"private_key_id"\s*:/;

// Private key PEM header
const RE_PRIVATE_KEY = /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/;

// JWT token (3 base64url segments)
const RE_JWT =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

// Database connection strings
const RE_CONN_STR =
  /(?:postgresql|postgres|mysql|mongodb(?:\+srv)?|redis|amqp(?:s)?):\/\/[^:@\s]{1,64}:[^@\s]{4,}@/i;

// GitHub / GitLab / generic PATs — "ghp_", "ghs_", "glpat-", etc.
const RE_GH_TOKEN = /\b(?:ghp|ghs|gho|github_pat)_[A-Za-z0-9_]{20,}/;
const RE_GL_TOKEN = /\bglpat-[A-Za-z0-9_-]{20,}/;

// Stripe secret key
const RE_STRIPE = /\bsk_(?:live|test)_[A-Za-z0-9]{24,}/;

// Slack token
const RE_SLACK = /\bxox[bpoas]-[0-9A-Za-z-]{10,}/;

// SendGrid / Twilio / Mailgun
const RE_SENDGRID = /\bSG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}/;
const RE_TWILIO = /\bAC[0-9a-f]{32}\b/;

// Generic high-entropy value in a "secret-looking" key (≥32 chars, mixed case+digits)
const RE_HIGH_ENTROPY = /^[A-Za-z0-9+/=_-]{32,}$/;

/** Env-var key names that strongly suggest the value is a secret */
const SECRET_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /private.?key/i,
  /api.?key/i,
  /api.?token/i,
  /auth.?token/i,
  /access.?token/i,
  /refresh.?token/i,
  /client.?secret/i,
  /db.?pass/i,
  /database.?pass/i,
  /jwt.?secret/i,
  /signing.?key/i,
  /encryption.?key/i,
  /hmac.?key/i,
  /webhook.?secret/i,
  /oauth.?secret/i,
];

/** Placeholder values we should not flag */
const PLACEHOLDER_RE =
  /^(?:your[_-]?|change.?me|replace.?me|<.*?>|\$\{.*?\}|{{.*?}}|todo|changeit|placeholder|example|test|dummy|fake|redacted|xxx+|null|undefined|none|n\/a|false|true|0|1|)$/i;

function redact(value: string): string {
  if (value.length <= 4) return "****";
  return value.slice(0, 4) + "…";
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim());
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan a map of env vars and return any detected secret patterns.
 * Values are never returned in full — only redacted snippets.
 */
export function scanEnvVars(envVars: Record<string, string>): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const [key, value] of Object.entries(envVars)) {
    if (!value || isPlaceholder(value)) continue;

    // High-confidence pattern matches on the value itself
    if (RE_AWS_KEY_ID.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "AWS Access Key ID", confidence: "high" });
      continue;
    }
    if (RE_PRIVATE_KEY.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "PEM Private Key", confidence: "high" });
      continue;
    }
    if (RE_GCP_SA_KEY.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "GCP Service Account Key (JSON)", confidence: "high" });
      continue;
    }
    if (RE_JWT.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "JWT Token", confidence: "high" });
      continue;
    }
    if (RE_CONN_STR.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "Database Connection String with credentials", confidence: "high" });
      continue;
    }
    if (RE_GH_TOKEN.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "GitHub Personal Access Token", confidence: "high" });
      continue;
    }
    if (RE_GL_TOKEN.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "GitLab Personal Access Token", confidence: "high" });
      continue;
    }
    if (RE_STRIPE.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "Stripe Secret Key", confidence: "high" });
      continue;
    }
    if (RE_SLACK.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "Slack Token", confidence: "high" });
      continue;
    }
    if (RE_SENDGRID.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "SendGrid API Key", confidence: "high" });
      continue;
    }
    if (RE_TWILIO.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "Twilio Account SID", confidence: "high" });
      continue;
    }

    // Medium-confidence: secret-named key with high-entropy value
    const keyLooksSecret = SECRET_KEY_PATTERNS.some((p) => p.test(key));
    if (keyLooksSecret && RE_HIGH_ENTROPY.test(value.trim())) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "High-entropy value in secret-named variable", confidence: "medium" });
      continue;
    }

    // Medium-confidence: AWS secret key pattern (only when key name looks like a secret)
    if (keyLooksSecret && RE_AWS_SECRET.test(value)) {
      matches.push({ key, redactedValue: redact(value), patternLabel: "Possible AWS Secret Access Key", confidence: "medium" });
      continue;
    }
  }

  return matches;
}
