import { sql } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";

export async function ensureCredentialsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS user_cloud_credentials (
      user_email   TEXT NOT NULL,
      provider     TEXT NOT NULL,
      credentials  TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, provider)
    )
  `;
}

export async function getUserCloudCredentials(
  email: string,
  provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github"
): Promise<Record<string, string> | null> {
  try {
    const result = await sql`
      SELECT credentials FROM user_cloud_credentials
      WHERE user_email = ${email} AND provider = ${provider}
    `;
    if (result.rows.length === 0) return null;
    const decrypted = decrypt(result.rows[0].credentials as string);
    return JSON.parse(decrypted) as Record<string, string>;
  } catch {
    return null;
  }
}

export async function listUserCloudCredentials(
  email: string
): Promise<{ provider: string; createdAt: string; updatedAt: string }[]> {
  const result = await sql`
    SELECT provider, created_at, updated_at FROM user_cloud_credentials
    WHERE user_email = ${email}
  `;
  return result.rows.map((r) => ({
    provider: r.provider as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function saveUserCloudCredentials(
  email: string,
  provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github",
  credentials: Record<string, string>
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(credentials));
  await sql`
    INSERT INTO user_cloud_credentials (user_email, provider, credentials, updated_at)
    VALUES (${email}, ${provider}, ${encrypted}, NOW())
    ON CONFLICT (user_email, provider) DO UPDATE
      SET credentials = EXCLUDED.credentials,
          updated_at = NOW()
  `;
}

export async function deleteUserCloudCredentials(
  email: string,
  provider: "gcp" | "aws" | "ghcr" | "dockerhub" | "github"
): Promise<void> {
  await sql`
    DELETE FROM user_cloud_credentials WHERE user_email = ${email} AND provider = ${provider}
  `;
}
