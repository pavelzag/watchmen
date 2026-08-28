import { retryOnce, sql } from "@/lib/db";
import { decrypt } from "@/lib/encryption";

export type AIProvider = "openai" | "anthropic" | "google";

export interface AIKeyRecord {
  provider: AIProvider;
  keyHint: string;
  isActive: boolean;
  createdAt: string;
}

/** Ensures the user_api_keys table exists. Safe to call on every request. */
let apiKeysTableReady: Promise<void> | null = null;

export async function ensureApiKeysTable() {
  if (!apiKeysTableReady) {
    apiKeysTableReady = retryOnce(async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_api_keys (
          user_email    TEXT NOT NULL,
          provider      TEXT NOT NULL,
          encrypted_key TEXT NOT NULL,
          key_hint      TEXT NOT NULL,
          is_active     BOOLEAN NOT NULL DEFAULT FALSE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_email, provider)
        )
      `;
    }).catch((error) => {
      apiKeysTableReady = null;
      throw error;
    });
  }

  await apiKeysTableReady;
}

/** Returns all key records for a user (no plaintext keys). */
export async function listUserKeys(userEmail: string): Promise<AIKeyRecord[]> {
  await ensureApiKeysTable();
  const result = await retryOnce(() => sql`
    SELECT provider, key_hint, is_active, created_at
    FROM user_api_keys
    WHERE user_email = ${userEmail}
    ORDER BY created_at ASC
  `);
  return result.rows.map((r) => ({
    provider: r.provider as AIProvider,
    keyHint: r.key_hint,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

/** Validates that an API key is structurally usable for its provider without depending on an app model choice. */
export async function validateAIKey(provider: AIProvider, apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required.");

  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: key });
    await openai.models.list();
    return;
  }

  await callAI(provider, key, "Reply with exactly one word: OK");
}

/** Retrieves and decrypts the active API key for a user. Returns null if none configured. */
export async function getActiveKey(userEmail: string): Promise<{ provider: AIProvider; key: string } | null> {
  await ensureApiKeysTable();
  const result = await retryOnce(() => sql`
    SELECT provider, encrypted_key
    FROM user_api_keys
    WHERE user_email = ${userEmail} AND is_active = TRUE
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { provider: row.provider as AIProvider, key: decrypt(row.encrypted_key) };
}

/** Calls the AI provider with the given prompt and returns the response text. */
export async function callAI(provider: AIProvider, apiKey: string, prompt: string): Promise<string> {
  if (provider === "google") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });
    return response.output_text ?? "";
  }

  if (provider === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    return block.type === "text" ? block.text : "";
  }

  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Resolves the active AI key for a user (from their Settings → AI Keys).
 * Throws "NO_AI_KEY" if none is configured.
 * 
 * SPECIAL CASE: For demo users, if no personal key is provided, we can fallback 
 * to a server-side Gemini key if configured and within limits.
 */
export async function resolveAI(userEmail: string, isDemoUser?: boolean): Promise<{ provider: AIProvider; key: string }> {
  // 1. Try personal/configured key first
  const userKey = await getActiveKey(userEmail);
  if (userKey) return userKey;

  // 2. Fallback for Demo User
  if (isDemoUser && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    await checkAndIncrementDemoUsage(userEmail);
    return { provider: "google", key: process.env.GOOGLE_GENERATIVE_AI_API_KEY };
  }

  throw new Error("NO_AI_KEY");
}

const MAX_DAILY_DEMO_QUERIES = 20;

/**
 * Checks if a demo user is under their daily limit AND if the global limit is reached.
 * Throws "DEMO_LIMIT_REACHED" if per-user limit hit.
 * Throws "GLOBAL_LIMIT_REACHED" if system-wide limit hit.
 */
async function checkAndIncrementDemoUsage(userEmail: string): Promise<void> {
  const { ensureDemoUsageTable, ensureGlobalUsageTable } = await import("@/lib/db");
  await ensureDemoUsageTable();
  await ensureGlobalUsageTable();

  // 1. Check/Increment Global Limit
  const globalResult = await sql`
    INSERT INTO global_usage (id, daily_count, max_limit, last_reset)
    VALUES (1, 1, 5000, CURRENT_DATE)
    ON CONFLICT (id) DO UPDATE
    SET 
      daily_count = CASE 
        WHEN global_usage.last_reset = EXCLUDED.last_reset THEN global_usage.daily_count + 1
        ELSE 1
      END,
      last_reset = EXCLUDED.last_reset
    RETURNING daily_count, max_limit
  `;

  if (globalResult.rows[0].daily_count > globalResult.rows[0].max_limit) {
    throw new Error("GLOBAL_LIMIT_REACHED");
  }

  // 2. Check/Increment Per-User Limit
  const userResult = await sql`
    INSERT INTO demo_usage (user_email, daily_count, last_reset)
    VALUES (${userEmail}, 1, CURRENT_DATE)
    ON CONFLICT (user_email) DO UPDATE
    SET 
      daily_count = CASE 
        WHEN demo_usage.last_reset = EXCLUDED.last_reset THEN demo_usage.daily_count + 1
        ELSE 1
      END,
      last_reset = EXCLUDED.last_reset
    RETURNING daily_count
  `;

  if (userResult.rows[0].daily_count > MAX_DAILY_DEMO_QUERIES) {
    throw new Error("DEMO_LIMIT_REACHED");
  }
}

/** Returns the current usage for a demo user and global system. */
export async function getDemoUsage(userEmail: string): Promise<{ count: number; limit: number; globalCount: number; globalLimit: number }> {
  const userRes = await sql`
    SELECT daily_count FROM demo_usage 
    WHERE user_email = ${userEmail} AND last_reset = CURRENT_DATE
  `;
  const globalRes = await sql`
    SELECT daily_count, max_limit FROM global_usage 
    WHERE id = 1 AND last_reset = CURRENT_DATE
  `;

  return {
    count: userRes.rows[0]?.daily_count ?? 0,
    limit: MAX_DAILY_DEMO_QUERIES,
    globalCount: globalRes.rows[0]?.daily_count ?? 0,
    globalLimit: globalRes.rows[0]?.max_limit ?? 5000
  };
}
