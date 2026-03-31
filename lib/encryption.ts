import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
// Legacy fixed salt — only used to decrypt old records (3-part format).
const LEGACY_SALT = "watchmen-api-keys-v1";

function getDerivedKey(salt: Buffer | string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET env var is required for key encryption");
  return scryptSync(secret, salt, 32) as Buffer;
}

/**
 * Encrypts a plaintext string.
 * Returns a colon-separated hex string: salt:iv:authTag:ciphertext
 * (per-record random salt so that compromising AUTH_SECRET alone is insufficient)
 */
export function encrypt(plaintext: string): string {
  const salt = randomBytes(16);
  const key = getDerivedKey(salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [salt.toString("hex"), iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a string previously produced by encrypt().
 * Supports both the legacy 3-part format (iv:authTag:ciphertext) and
 * the current 4-part format (salt:iv:authTag:ciphertext).
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  let key: Buffer;
  let ivHex: string, authTagHex: string, ciphertextHex: string;

  if (parts.length === 4) {
    // Current format: salt:iv:authTag:ciphertext
    const [saltHex, iv, authTag, ciphertext] = parts;
    key = getDerivedKey(Buffer.from(saltHex, "hex"));
    ivHex = iv; authTagHex = authTag; ciphertextHex = ciphertext;
  } else if (parts.length === 3) {
    // Legacy format: iv:authTag:ciphertext (fixed salt)
    [ivHex, authTagHex, ciphertextHex] = parts;
    key = getDerivedKey(LEGACY_SALT);
  } else {
    throw new Error("Invalid encrypted format");
  }

  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
