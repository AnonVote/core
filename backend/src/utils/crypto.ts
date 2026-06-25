import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";

/**
 * SHA-256 hash of a voter identifier.
 * Used to store eligibility entries without retaining the original identifier.
 */
export function hashIdentifier(id: string): string {
  return createHash("sha256").update(id.trim().toLowerCase()).digest("hex");
}

/**
 * Generate a cryptographically secure random token.
 * 32 bytes = 256 bits of entropy, hex encoded.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * SHA-256 hash of a raw voter token.
 * Only the hash is stored — the raw token is never persisted.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Encrypt a vote option ID using AES-256-GCM.
 * @param optionId - The option ID to encrypt
 * @param ballotKey - 64-char hex string (32 bytes) from env config
 * @returns base64 string in format: iv:authTag:ciphertext
 */
export function encryptVote(optionId: string, ballotKey: string): string {
  const key = Buffer.from(ballotKey, "hex");
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(optionId, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a vote payload encrypted with encryptVote.
 * @param payload - base64 string in format: iv:authTag:ciphertext
 * @param ballotKey - 64-char hex string (32 bytes) from env config
 * @returns the original optionId
 */
export function decryptVote(payload: string, ballotKey: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  const key = Buffer.from(ballotKey, "hex");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Encrypt an arbitrary string (used for recipient encryption in retries).
 * Returns base64 string in format iv:authTag:ciphertext
 */
export function encryptString(plain: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptString(payload: string, hexKey: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  const key = Buffer.from(hexKey, "hex");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
