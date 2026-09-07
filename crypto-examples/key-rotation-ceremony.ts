/**
 * Key Rotation Ceremony — AnonVote key management examples
 *
 * Demonstrates:
 *  1. Basic setup with SimpleKeyManager
 *  2. Encrypting a vote and storing the key reference
 *  3. Rotating to a new key version
 *  4. Decrypting a historical vote after rotation (using the archived key)
 *  5. Pattern for plugging in AWS KMS or HashiCorp Vault
 *
 * Run this file with:
 *   npx tsx examples/key-rotation-ceremony.ts
 */

import {
  AnonVoteClient,
  SimpleKeyManager,
  deriveKey,
  rotateKey,
  isRotationDue,
} from "../src/index";
import type { KeyManager, KeyVersion, RotationPolicy } from "../src/index";
import type { EncryptedPayloadWithKeyRef } from "../src/types";

// ── 1. Basic setup ────────────────────────────────────────────────────────────

// In production, load this from AWS Secrets Manager / HashiCorp Vault.
// Never hardcode or log the master key.
const MASTER_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

const km = new SimpleKeyManager(MASTER_KEY, "ballot-encryption");
const client = new AnonVoteClient({ keyManager: km });

console.log("Active key version:", km.getCurrentKey().metadata.version);
console.log("Key ID:", km.getKeyId());

// ── 2. Encrypt a vote (stores key version reference in payload) ───────────────

const election = client.createElection({
  title: "Board Election 2025",
  description: "Elect the new board",
  options: ["Alice", "Bob", "Charlie"],
  startTime: Date.now(),
  endTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
});

const receipt = client.castVote({
  ballotId: election.id,
  voteOption: "Alice",
});

// When KeyManager is active, the payload includes keyId + keyVersion
const payload = receipt.encryptedPayload as EncryptedPayloadWithKeyRef;
console.log("\nEncrypted vote payload:");
console.log("  ciphertext:", payload.ciphertext.slice(0, 16) + "...");
console.log("  keyId:     ", payload.keyId);
console.log("  keyVersion:", payload.keyVersion);

// ── 3. Key rotation ───────────────────────────────────────────────────────────

// Check if rotation is due per policy
const policy: RotationPolicy = { interval: "monthly" };
const current = km.getCurrentKey();
console.log("\nRotation due?", isRotationDue(current, policy));

// Rotate — old key is archived inside the manager, not deleted
const newVersion = km.rotate(policy);
console.log("Rotated to version:", newVersion.metadata.version);
console.log("All versions:", km.getAllVersions().map((v) => v.metadata.version));

// ── 4. Verify a historical vote after rotation ────────────────────────────────

// The client finds the correct historical key via keyId + keyVersion in the payload
const stillValid = client.verifyVote(payload);
console.log("\nHistorical vote still verifiable after rotation:", stillValid);

// ── 5. Manual HKDF key derivation ────────────────────────────────────────────

// If you manage versions externally (e.g. in a database), derive keys on demand:
const v1Key = deriveKey(MASTER_KEY, "ballot-encryption", 1);
const v2Key = deriveKey(MASTER_KEY, "ballot-encryption", 2);
const orgKey = deriveKey(MASTER_KEY, "org-123-encryption", 1);

console.log("\nDerived keys are independent:");
console.log("  v1 !== v2:", v1Key !== v2Key);
console.log("  v1 !== org:", v1Key !== orgKey);

// Same inputs always produce the same key (deterministic):
const v1Again = deriveKey(MASTER_KEY, "ballot-encryption", 1);
console.log("  deterministic:", v1Key === v1Again);

// ── 6. AWS KMS integration pattern ───────────────────────────────────────────

/**
 * Example KMS-backed KeyManager (pseudocode — requires `@aws-sdk/client-kms`).
 *
 * In production:
 * - The master key never leaves AWS KMS.
 * - HKDF derivation is done locally using the data key that KMS decrypts.
 * - Key metadata (version, derivedAt, etc.) is stored in your database.
 *
 * ```typescript
 * import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
 * import { deriveKey, createKeyVersion } from "@anonvote/crypto";
 * import type { KeyManager, KeyVersion } from "@anonvote/crypto";
 *
 * export class KmsKeyManager implements KeyManager {
 *   private kms = new KMSClient({ region: "us-east-1" });
 *   private keyArn = process.env.KMS_KEY_ARN!;
 *   private keyId = process.env.KEY_ID!;
 *   private versions: Map<number, KeyVersion> = new Map();
 *   private currentVersion = 1;
 *
 *   async bootstrap() {
 *     // Fetch plaintext master key from KMS at startup
 *     const { Plaintext } = await this.kms.send(new DecryptCommand({
 *       CiphertextBlob: Buffer.from(process.env.ENCRYPTED_MASTER_KEY!, "base64"),
 *       KeyId: this.keyArn,
 *     }));
 *     const masterKey = Buffer.from(Plaintext!).toString("hex");
 *     const derived = deriveKey(masterKey, this.keyId, 1);
 *     this.versions.set(1, createKeyVersion(derived, this.keyId, 1));
 *   }
 *
 *   getCurrentKey() { return this.versions.get(this.currentVersion)!; }
 *   getKeyVersion(keyId: string, version: number) {
 *     if (keyId !== this.keyId) return null;
 *     return this.versions.get(version) ?? null;
 *   }
 * }
 * ```
 */

console.log("\nSee code comments for AWS KMS integration pattern.");

// ── 7. HashiCorp Vault integration pattern (pseudocode) ───────────────────────
/**
 * HashiCorp Vault pattern:
 *
 * ```typescript
 * const secret = await vault.read("secret/data/anonvote/master-key");
 * const masterKey = secret.data.data.key as string;
 * const km = new SimpleKeyManager(masterKey, "ballot-encryption");
 * ```
 *
 * For rotation ceremonies, trigger via Vault's key rotation API and call
 * `km.rotate({ interval: "manual" })` after fetching the new key material.
 */

console.log("Done.");

// ── Re-export for Vault pattern (avoids unused-import lint errors) ────────────
export { rotateKey };
