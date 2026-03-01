import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const SALT = "watchmen-api-keys-v1";

function getDerivedKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET env var is required for key encryption");
  return scryptSync(secret, SALT, 32) as Buffer;
}

/**
 * Encrypts a plaintext string.
 * Returns a colon-separated hex string: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a string previously produced by encrypt().
 */
export function decrypt(encoded: string): string {
  const key = getDerivedKey();
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
