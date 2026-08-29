/**
 * Versioned cryptographic key management and rotation for AnonVote.
 *
 * Implements HKDF (RFC 5869) key derivation so multiple independent child
 * keys can be derived from a single high-entropy master key. Each derived
 * key is wrapped in `KeyVersion` metadata so historical votes can always be
 * decrypted with the key version that was used at the time of encryption.
 *
 * ## Quick-start
 *
 * ```typescript
 * import { SimpleKeyManager } from "@anonvote/crypto";
 *
 * const km = new SimpleKeyManager(process.env.MASTER_KEY!);
 * const client = new AnonVoteClient({ keyManager: km });
 * ```
 *
 * ## Backward compatibility
 *
 * Existing deployments that pass `encryptionKey` directly to `AnonVoteClient`
 * continue to work unchanged. `KeyManager` is purely additive.
 */

import { getNodeCrypto, bytesToHex } from "./random";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Metadata attached to every derived key version.
 *
 * The `id` and `version` together uniquely identify the key. Store this
 * alongside any encrypted payload so you can reconstruct the exact key that
 * was used at decryption time.
 */
export interface KeyMetadata {
  /** Stable identifier for the key family (e.g. "ballot-encryption", "org-123"). */
  id: string;
  /** Monotonically increasing version number. Starts at 1. */
  version: number;
  /** ISO 8601 timestamp when this key version was derived. */
  derivedAt: string;
  /** ISO 8601 expiry timestamp, if this key version has a fixed lifetime. */
  expiresAt?: string;
  /** ISO 8601 timestamp when this key was superseded by a rotation. */
  rotatedAt?: string;
}

/**
 * A derived child key paired with its metadata.
 *
 * `keyHex` is a 64-character hex string (32 bytes) suitable for AES-256-GCM.
 */
export interface KeyVersion {
  /** The derived key as a 64-character hex string (32 bytes for AES-256-GCM). */
  keyHex: string;
  metadata: KeyMetadata;
}

/**
 * Policy that controls when automatic rotation should occur.
 */
export interface RotationPolicy {
  interval: "daily" | "weekly" | "monthly" | "manual";
  /** Maximum age of a key in milliseconds before rotation is due. */
  maxAgeMs?: number;
}

/**
 * Minimal interface that `AnonVoteClient` depends on for key access.
 *
 * Implement this to plug in AWS KMS, HashiCorp Vault, or any other
 * secure storage backend (see `examples/key-rotation-ceremony.ts`).
 */
export interface KeyManager {
  /** Returns the active key version that should be used for new encryptions. */
  getCurrentKey(): KeyVersion;
  /**
   * Returns a specific historical key version for decryption.
   * @param keyId   - The key family identifier stored in the encrypted payload metadata.
   * @param version - The version number stored in the encrypted payload metadata.
   * @returns The matching `KeyVersion`, or `null` if not found.
   */
  getKeyVersion(keyId: string, version: number): KeyVersion | null;
}

// ── HKDF implementation (RFC 5869) ───────────────────────────────────────────

/**
 * HKDF-Extract step (RFC 5869 §2.2).
 *
 * Combines an optional salt with the input keying material to produce a
 * pseudorandom key (PRK) using HMAC-SHA256.
 */
function hkdfExtract(ikm: Buffer, salt?: Buffer): Buffer {
  const { createHmac } = getNodeCrypto();
  const effectiveSalt =
    salt && salt.length > 0 ? salt : Buffer.alloc(32, 0);
  return createHmac("sha256", effectiveSalt).update(ikm).digest();
}

/**
 * HKDF-Expand step (RFC 5869 §2.3).
 *
 * Expands the pseudorandom key into output keying material of the requested
 * length. The `info` string ties the derived key to its intended context.
 *
 * @param prk    - Pseudorandom key from {@link hkdfExtract} (32 bytes for SHA-256).
 * @param info   - Context/application-specific information string.
 * @param length - Required output length in bytes (max 255 * 32 = 8160 for SHA-256).
 */
function hkdfExpand(prk: Buffer, info: string, length: number): Buffer {
  const { createHmac } = getNodeCrypto();
  const hashLen = 32; // SHA-256 output size
  const n = Math.ceil(length / hashLen);
  if (n > 255) {
    throw new Error(
      `HKDF output length ${length} exceeds maximum for SHA-256 (8160 bytes)`,
    );
  }

  const infoBuffer = Buffer.from(info, "utf8");
  let t = Buffer.alloc(0);
  const okm: Buffer[] = [];

  for (let i = 1; i <= n; i++) {
    const input = Buffer.concat([t, infoBuffer, Buffer.from([i])]);
    t = createHmac("sha256", prk).update(input).digest();
    okm.push(t);
  }

  return Buffer.concat(okm).subarray(0, length);
}

/**
 * Full HKDF (RFC 5869) key derivation using HMAC-SHA256.
 *
 * Derives a 32-byte child key from a master key, a unique key identifier, and
 * a version number. The same inputs always produce the same output (deterministic).
 *
 * The `info` string binds the derived key to its intended use — different
 * `keyId` / `version` combinations produce independent, unrelated keys even
 * if the master key is the same.
 *
 * @param masterKey - High-entropy master key as a 64-char hex string (32 bytes).
 * @param keyId     - Stable identifier for the key family (public, e.g. "ballot-encryption").
 * @param version   - Monotonically increasing version number (≥ 1).
 * @returns A 32-byte derived key as a 64-character hex string.
 *
 * @example
 * const childKey = deriveKey(process.env.MASTER_KEY!, "ballot-encryption", 1);
 * // childKey is a 64-char hex string, deterministic for these inputs.
 */
export function deriveKey(
  masterKey: string,
  keyId: string,
  version: number,
): string {
  if (!masterKey || masterKey.length < 32) {
    throw new Error(
      "masterKey must be at least 32 characters (64-char hex recommended)",
    );
  }
  if (!keyId || keyId.trim().length === 0) {
    throw new Error("keyId must be a non-empty string");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer (≥ 1)");
  }

  const ikm = Buffer.from(masterKey, "hex");
  const salt = Buffer.from(keyId, "utf8");
  const info = `anonvote:${keyId}:v${version}`;

  const prk = hkdfExtract(ikm, salt);
  const okm = hkdfExpand(prk, info, 32);
  return bytesToHex(okm);
}

// ── Key ID generation ─────────────────────────────────────────────────────────

/**
 * Generates a random, unique key family identifier.
 *
 * Format: `key-<12 random hex chars>-<unix seconds>`
 * This is a public, non-secret identifier — safe to store alongside
 * encrypted data so the correct key family can be located at decryption time.
 */
export function generateKeyId(): string {
  const { randomBytes } = getNodeCrypto();
  const rand = randomBytes(6).toString("hex");
  const ts = Math.floor(Date.now() / 1000);
  return `key-${rand}-${ts}`;
}

// ── Key version helpers ───────────────────────────────────────────────────────

/**
 * Wraps a raw hex key with metadata to form a `KeyVersion`.
 *
 * @param keyHex  - 64-character hex key string.
 * @param keyId   - Key family identifier.
 * @param version - Version number.
 * @param opts    - Optional `expiresAt` ISO string.
 */
export function createKeyVersion(
  keyHex: string,
  keyId: string,
  version: number,
  opts: { expiresAt?: string } = {},
): KeyVersion {
  return {
    keyHex,
    metadata: {
      id: keyId,
      version,
      derivedAt: new Date().toISOString(),
      expiresAt: opts.expiresAt,
    },
  };
}

/**
 * Derives and wraps a new key version from a master key.
 *
 * Convenience wrapper that calls {@link deriveKey} and {@link createKeyVersion}
 * together.
 *
 * @param masterKey - 64-char hex master key.
 * @param keyId     - Key family identifier.
 * @param version   - Version number (must be ≥ 1).
 * @param opts      - Optional `expiresAt` ISO string.
 */
export function deriveKeyVersion(
  masterKey: string,
  keyId: string,
  version: number,
  opts: { expiresAt?: string } = {},
): KeyVersion {
  const keyHex = deriveKey(masterKey, keyId, version);
  return createKeyVersion(keyHex, keyId, version, opts);
}

// ── Rotation ──────────────────────────────────────────────────────────────────

/**
 * Creates the next key version by incrementing the version counter.
 *
 * The old key is archived by stamping a `rotatedAt` timestamp on its metadata;
 * it is never deleted so historical votes can still be decrypted.
 *
 * @param masterKey      - 64-char hex master key used for HKDF derivation.
 * @param currentVersion - The currently active `KeyVersion`.
 * @param policy         - Rotation policy (informational; enforcement is caller's responsibility).
 * @returns An object containing the new `KeyVersion` and the archived old version.
 *
 * @example
 * const { newVersion, archivedVersion } = rotateKey(MASTER_KEY, current, { interval: "monthly" });
 * store.archive(archivedVersion);
 * store.setCurrent(newVersion);
 */
export function rotateKey(
  masterKey: string,
  currentVersion: KeyVersion,
  _policy: RotationPolicy,
): { newVersion: KeyVersion; archivedVersion: KeyVersion } {
  const nextVersionNumber = currentVersion.metadata.version + 1;
  const now = new Date().toISOString();

  const archivedVersion: KeyVersion = {
    ...currentVersion,
    metadata: { ...currentVersion.metadata, rotatedAt: now },
  };

  const newVersion = deriveKeyVersion(
    masterKey,
    currentVersion.metadata.id,
    nextVersionNumber,
  );

  return { newVersion, archivedVersion };
}

/**
 * Returns `true` if a key version is due for rotation according to the given policy.
 */
export function isRotationDue(
  kv: KeyVersion,
  policy: RotationPolicy,
): boolean {
  if (policy.interval === "manual") return false;

  const maxAgeMs =
    policy.maxAgeMs ??
    {
      daily: 86_400_000,
      weekly: 7 * 86_400_000,
      monthly: 30 * 86_400_000,
    }[policy.interval];

  const age = Date.now() - new Date(kv.metadata.derivedAt).getTime();
  return age >= maxAgeMs;
}

// ── SimpleKeyManager ──────────────────────────────────────────────────────────

/**
 * In-process `KeyManager` backed by a master key and an in-memory version store.
 *
 * Suitable for single-server deployments where the master key comes from an
 * environment variable or a secrets manager at startup. For production
 * multi-server deployments, inject a `KeyManager` backed by AWS KMS or
 * HashiCorp Vault (see `examples/key-rotation-ceremony.ts`).
 *
 * @example
 * ```typescript
 * const km = new SimpleKeyManager(process.env.MASTER_KEY!, "ballot-encryption");
 * km.rotate({ interval: "monthly" });
 * const client = new AnonVoteClient({ keyManager: km });
 * ```
 */
export class SimpleKeyManager implements KeyManager {
  private masterKey: string;
  private keyId: string;
  private versions: Map<number, KeyVersion> = new Map();
  private currentVersionNumber: number = 1;

  /**
   * @param masterKey - 64-char hex master key (32 bytes).
   * @param keyId     - Key family identifier. Defaults to a generated ID.
   */
  constructor(masterKey: string, keyId?: string) {
    this.masterKey = masterKey;
    this.keyId = keyId ?? generateKeyId();

    // Seed with version 1
    const v1 = deriveKeyVersion(this.masterKey, this.keyId, 1);
    this.versions.set(1, v1);
  }

  getCurrentKey(): KeyVersion {
    return this.versions.get(this.currentVersionNumber)!;
  }

  getKeyVersion(keyId: string, version: number): KeyVersion | null {
    if (keyId !== this.keyId) return null;
    return this.versions.get(version) ?? null;
  }

  /**
   * Rotates to the next key version and archives the current one.
   *
   * @param policy - Rotation policy passed to {@link rotateKey}.
   * @returns The newly active `KeyVersion`.
   */
  rotate(policy: RotationPolicy = { interval: "manual" }): KeyVersion {
    const current = this.getCurrentKey();
    const { newVersion, archivedVersion } = rotateKey(
      this.masterKey,
      current,
      policy,
    );
    this.versions.set(current.metadata.version, archivedVersion);
    this.versions.set(newVersion.metadata.version, newVersion);
    this.currentVersionNumber = newVersion.metadata.version;
    return newVersion;
  }

  /**
   * Returns all stored key versions (current and archived), sorted ascending.
   */
  getAllVersions(): KeyVersion[] {
    return [...this.versions.values()].sort(
      (a, b) => a.metadata.version - b.metadata.version,
    );
  }

  /** The key family identifier for this manager. */
  getKeyId(): string {
    return this.keyId;
  }
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Retrieves a key version from a `KeyManager`.
 *
 * @throws If the requested version is not found (e.g. it was never stored).
 */
export function lookupKeyVersion(
  manager: KeyManager,
  keyId: string,
  version: number,
): KeyVersion {
  const kv = manager.getKeyVersion(keyId, version);
  if (!kv) {
    throw new Error(
      `Key version not found: keyId="${keyId}" version=${version}`,
    );
  }
  return kv;
}

/**
 * Returns the active key hex string from a `KeyManager`.
 * Convenience wrapper used by `AnonVoteClient`.
 */
export function getCurrentKeyHex(manager: KeyManager): string {
  return manager.getCurrentKey().keyHex;
}
