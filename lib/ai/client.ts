import { sql } from "@/lib/db";
import { decrypt } from "@/lib/encryption";

export type AIProvider = "openai" | "anthropic" | "google";

export interface AIKeyRecord {
  provider: AIProvider;
  keyHint: string;
  isActive: boolean;
  createdAt: string;
}

/** Ensures the user_api_keys table exists. Safe to call on every request. */
export async function ensureApiKeysTable() {
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
}

/** Returns all key records for a user (no plaintext keys). */
export async function listUserKeys(userEmail: string): Promise<AIKeyRecord[]> {
  await ensureApiKeysTable();
  const result = await sql`
    SELECT provider, key_hint, is_active, created_at
    FROM user_api_keys
    WHERE user_email = ${userEmail}
    ORDER BY created_at ASC
  `;
  return result.rows.map((r) => ({
    provider: r.provider as AIProvider,
    keyHint: r.key_hint,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

/** Retrieves and decrypts the active API key for a user. Returns null if none configured. */
export async function getActiveKey(userEmail: string): Promise<{ provider: AIProvider; key: string } | null> {
  await ensureApiKeysTable();
  const result = await sql`
    SELECT provider, encrypted_key
    FROM user_api_keys
    WHERE user_email = ${userEmail} AND is_active = TRUE
    LIMIT 1
  `;
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
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    return completion.choices[0]?.message?.content ?? "";
  }

  if (provider === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    return block.type === "text" ? block.text : "";
  }

  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Resolves the AI to use for a request:
 * 1. User's active key (if configured)
 * 2. Server's GEMINI_API_KEY env var (fallback)
 * Throws if neither is available.
 */
export async function resolveAI(userEmail: string): Promise<{ provider: AIProvider; key: string }> {
  const userKey = await getActiveKey(userEmail);
  if (userKey) return userKey;

  const serverKey = process.env.GEMINI_API_KEY;
  if (serverKey) return { provider: "google", key: serverKey };

  throw new Error("NO_AI_KEY");
}
