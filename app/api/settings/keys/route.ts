import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { listUserKeys, ensureApiKeysTable, validateAIKey, type AIProvider } from "@/lib/ai/client";

function formatKeyValidationError(provider: AIProvider, apiKey: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = apiKey.trim();

  if (provider === "openai" && trimmed.startsWith("sk-ant-")) {
    return "OpenAI rejected this key. It looks like an Anthropic Claude key; choose Anthropic or paste an OpenAI key from platform.openai.com.";
  }
  if (provider === "anthropic" && trimmed.startsWith("sk-proj-")) {
    return "Anthropic rejected this key. It looks like an OpenAI project key; choose OpenAI or paste an Anthropic key.";
  }
  if (provider === "google" && !trimmed.startsWith("AIza")) {
    return `Google rejected this key. Gemini API keys usually start with AIza. Provider said: ${message}`;
  }

  return message;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Demo users should only use browser-stored keys
  if (session.isDemoUser) {
    return NextResponse.json({ keys: [] });
  }

  try {
    const keys = await listUserKeys(session.user.email);
    return NextResponse.json({ keys });
  } catch (err) {
    console.error("[api/settings/keys] GET error:", err);
    return NextResponse.json({ error: "Failed to load keys." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider, apiKey, dryRun } = await req.json() as { provider: AIProvider; apiKey: string; dryRun?: boolean };

  if (!["openai", "anthropic", "google"].includes(provider)) {
    return NextResponse.json({ error: "Invalid provider." }, { status: 400 });
  }
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: "API key is required." }, { status: 400 });
  }

  // Test the key before saving
  try {
    await validateAIKey(provider, apiKey.trim());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const userMessage = formatKeyValidationError(provider, apiKey, err);
    console.warn("[api/settings/keys] key validation failed", {
      provider,
      message: msg,
      status: typeof err === "object" && err !== null && "status" in err ? (err as { status?: unknown }).status : undefined,
      code: typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined,
      type: typeof err === "object" && err !== null && "type" in err ? (err as { type?: unknown }).type : undefined,
    });
    return NextResponse.json({ error: `Key validation failed: ${userMessage}` }, { status: 422 });
  }

  // If this is a dry run (browser-only storage), stop here
  if (dryRun) {
    return NextResponse.json({ ok: true, message: "Key validated." });
  }

  // Demo users are not allowed to save keys to the database
  if (session.isDemoUser) {
    return NextResponse.json(
      { error: "In Demo mode, please use the 'Save to browser only' option to keep keys isolated." },
      { status: 403 }
    );
  }

  const keyHint = apiKey.trim().slice(-4);
  const encryptedKey = encrypt(apiKey.trim());

  await ensureApiKeysTable();

  const email = session.user.email;

  // Upsert the key; if this is the first key for this user, make it active
  const existing = await sql`SELECT provider FROM user_api_keys WHERE user_email = ${email}`;
  const isFirst = existing.rows.length === 0;

  await sql`
    INSERT INTO user_api_keys (user_email, provider, encrypted_key, key_hint, is_active)
    VALUES (${email}, ${provider}, ${encryptedKey}, ${keyHint}, ${isFirst})
    ON CONFLICT (user_email, provider) DO UPDATE
      SET encrypted_key = EXCLUDED.encrypted_key,
          key_hint = EXCLUDED.key_hint
  `;

  const keys = await listUserKeys(email);
  return NextResponse.json({ ok: true, keys });
}
