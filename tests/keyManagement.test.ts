/**
 * Tests for src/keyManagement.ts — issue #76
 *
 * Covers:
 * - HKDF key derivation (RFC 5869 compliance, determinism, independence)
 * - Key versioning (createKeyVersion, deriveKeyVersion)
 * - Key rotation (rotateKey, isRotationDue, SimpleKeyManager.rotate)
 * - Historical key lookup (lookupKeyVersion, getKeyVersion)
 * - AnonVoteClient integration (KeyManager mode and legacy mode)
 * - Backward compatibility (raw encryptionKey still works)
 */

import {
  deriveKey,
  deriveKeyVersion,
  createKeyVersion,
  generateKeyId,
  rotateKey,
  isRotationDue,
  lookupKeyVersion,
  getCurrentKeyHex,
  SimpleKeyManager,
} from "../src/keyManagement";
import type { KeyManager, KeyVersion, RotationPolicy } from "../src/keyManagement";
import { AnonVoteClient } from "../src/client";
import { encryptVote, decryptVote } from "../src/crypto";
import type { EncryptedPayloadWithKeyRef } from "../src/types";

const MASTER_KEY = "deadbeef".repeat(8); // 64-char hex = 32 bytes
const MASTER_KEY_B = "cafebabe".repeat(8);

// ── HKDF key derivation ───────────────────────────────────────────────────────

describe("deriveKey", () => {
  it("returns a 64-character hex string (32 bytes)", () => {
    const key = deriveKey(MASTER_KEY, "ballot", 1);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs always produce the same key", () => {
    const k1 = deriveKey(MASTER_KEY, "ballot", 1);
    const k2 = deriveKey(MASTER_KEY, "ballot", 1);
    expect(k1).toBe(k2);
  });

  it("produces different keys for different versions", () => {
    const k1 = deriveKey(MASTER_KEY, "ballot", 1);
    const k2 = deriveKey(MASTER_KEY, "ballot", 2);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different keyIds", () => {
    const k1 = deriveKey(MASTER_KEY, "ballot-a", 1);
    const k2 = deriveKey(MASTER_KEY, "ballot-b", 1);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different master keys", () => {
    const k1 = deriveKey(MASTER_KEY, "ballot", 1);
    const k2 = deriveKey(MASTER_KEY_B, "ballot", 1);
    expect(k1).not.toBe(k2);
  });

  it("throws if masterKey is too short", () => {
    expect(() => deriveKey("short", "ballot", 1)).toThrow();
  });

  it("throws if keyId is empty", () => {
    expect(() => deriveKey(MASTER_KEY, "", 1)).toThrow();
  });

  it("throws if version is zero", () => {
    expect(() => deriveKey(MASTER_KEY, "ballot", 0)).toThrow();
  });

  it("throws if version is negative", () => {
    expect(() => deriveKey(MASTER_KEY, "ballot", -1)).toThrow();
  });

  it("throws if version is non-integer", () => {
    expect(() => deriveKey(MASTER_KEY, "ballot", 1.5)).toThrow();
  });
});

// ── Key versioning ────────────────────────────────────────────────────────────

describe("createKeyVersion", () => {
  it("wraps a raw key with correct metadata", () => {
    const keyHex = "a".repeat(64);
    const kv = createKeyVersion(keyHex, "my-key", 3);
    expect(kv.keyHex).toBe(keyHex);
    expect(kv.metadata.id).toBe("my-key");
    expect(kv.metadata.version).toBe(3);
    expect(kv.metadata.derivedAt).toBeTruthy();
    expect(kv.metadata.rotatedAt).toBeUndefined();
    expect(kv.metadata.expiresAt).toBeUndefined();
  });

  it("stores optional expiresAt", () => {
    const exp = new Date(Date.now() + 86_400_000).toISOString();
    const kv = createKeyVersion("a".repeat(64), "k", 1, { expiresAt: exp });
    expect(kv.metadata.expiresAt).toBe(exp);
  });
});

describe("deriveKeyVersion", () => {
  it("derives a key and wraps it in a KeyVersion", () => {
    const kv = deriveKeyVersion(MASTER_KEY, "ballot", 1);
    expect(kv.keyHex).toHaveLength(64);
    expect(kv.metadata.version).toBe(1);
    expect(kv.metadata.id).toBe("ballot");
  });

  it("produces the same hex as deriveKey", () => {
    const hex = deriveKey(MASTER_KEY, "ballot", 2);
    const kv = deriveKeyVersion(MASTER_KEY, "ballot", 2);
    expect(kv.keyHex).toBe(hex);
  });
});

describe("generateKeyId", () => {
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 20 }, generateKeyId));
    expect(ids.size).toBe(20);
  });

  it("starts with 'key-'", () => {
    expect(generateKeyId()).toMatch(/^key-/);
  });
});

// ── Key rotation ──────────────────────────────────────────────────────────────

describe("rotateKey", () => {
  const policy: RotationPolicy = { interval: "manual" };

  it("increments the version number", () => {
    const current = deriveKeyVersion(MASTER_KEY, "ballot", 1);
    const { newVersion } = rotateKey(MASTER_KEY, current, policy);
    expect(newVersion.metadata.version).toBe(2);
  });

  it("new version key differs from old", () => {
    const current = deriveKeyVersion(MASTER_KEY, "ballot", 1);
    const { newVersion } = rotateKey(MASTER_KEY, current, policy);
    expect(newVersion.keyHex).not.toBe(current.keyHex);
  });

  it("archives the old version with rotatedAt set", () => {
    const current = deriveKeyVersion(MASTER_KEY, "ballot", 1);
    const { archivedVersion } = rotateKey(MASTER_KEY, current, policy);
    expect(archivedVersion.metadata.rotatedAt).toBeTruthy();
    expect(archivedVersion.metadata.version).toBe(1);
  });

  it("preserves the keyId across rotation", () => {
    const current = deriveKeyVersion(MASTER_KEY, "ballot", 1);
    const { newVersion } = rotateKey(MASTER_KEY, current, policy);
    expect(newVersion.metadata.id).toBe("ballot");
  });
});

describe("isRotationDue", () => {
  function kvWithAge(ageMs: number): KeyVersion {
    const derivedAt = new Date(Date.now() - ageMs).toISOString();
    return {
      keyHex: "a".repeat(64),
      metadata: { id: "k", version: 1, derivedAt },
    };
  }

  it("returns false for manual policy", () => {
    const kv = kvWithAge(999_999_999);
    expect(isRotationDue(kv, { interval: "manual" })).toBe(false);
  });

  it("returns true for daily policy when key is 2 days old", () => {
    const kv = kvWithAge(2 * 86_400_000);
    expect(isRotationDue(kv, { interval: "daily" })).toBe(true);
  });

  it("returns false for monthly policy when key is 1 day old", () => {
    const kv = kvWithAge(86_400_000);
    expect(isRotationDue(kv, { interval: "monthly" })).toBe(false);
  });

  it("respects custom maxAgeMs", () => {
    const kv = kvWithAge(5_000);
    expect(isRotationDue(kv, { interval: "daily", maxAgeMs: 3_000 })).toBe(true);
    expect(isRotationDue(kv, { interval: "daily", maxAgeMs: 10_000 })).toBe(false);
  });
});

// ── SimpleKeyManager ──────────────────────────────────────────────────────────

describe("SimpleKeyManager", () => {
  it("initialises with version 1", () => {
    const km = new SimpleKeyManager(MASTER_KEY);
    expect(km.getCurrentKey().metadata.version).toBe(1);
  });

  it("uses the supplied keyId", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "my-key");
    expect(km.getCurrentKey().metadata.id).toBe("my-key");
    expect(km.getKeyId()).toBe("my-key");
  });

  it("rotate() increments current version", () => {
    const km = new SimpleKeyManager(MASTER_KEY);
    km.rotate();
    expect(km.getCurrentKey().metadata.version).toBe(2);
  });

  it("getKeyVersion returns archived versions after rotation", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "bal");
    const v1Key = km.getCurrentKey().keyHex;
    km.rotate();
    const v1 = km.getKeyVersion("bal", 1);
    expect(v1).not.toBeNull();
    expect(v1!.keyHex).toBe(v1Key);
  });

  it("getKeyVersion returns null for unknown keyId", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "bal");
    expect(km.getKeyVersion("other", 1)).toBeNull();
  });

  it("getKeyVersion returns null for unknown version", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "bal");
    expect(km.getKeyVersion("bal", 99)).toBeNull();
  });

  it("getAllVersions returns all versions in ascending order", () => {
    const km = new SimpleKeyManager(MASTER_KEY);
    km.rotate();
    km.rotate();
    const versions = km.getAllVersions().map((v) => v.metadata.version);
    expect(versions).toEqual([1, 2, 3]);
  });
});

// ── lookupKeyVersion ──────────────────────────────────────────────────────────

describe("lookupKeyVersion", () => {
  it("returns the correct version", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "bal");
    km.rotate();
    const kv = lookupKeyVersion(km, "bal", 1);
    expect(kv.metadata.version).toBe(1);
  });

  it("throws if version is not found", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "bal");
    expect(() => lookupKeyVersion(km, "bal", 99)).toThrow(/not found/i);
  });
});

describe("getCurrentKeyHex", () => {
  it("returns the active key hex", () => {
    const km = new SimpleKeyManager(MASTER_KEY);
    const hex = getCurrentKeyHex(km);
    expect(hex).toBe(km.getCurrentKey().keyHex);
    expect(hex).toHaveLength(64);
  });
});

// ── AnonVoteClient integration ────────────────────────────────────────────────

describe("AnonVoteClient with KeyManager", () => {
  it("castVote embeds keyId and keyVersion in the payload", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "ballot");
    const client = new AnonVoteClient({ keyManager: km });
    const election = client.createElection({
      title: "Test",
      description: "d",
      options: ["Yes", "No"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
    const receipt = client.castVote({ ballotId: election.id, voteOption: "Yes" });
    const payload = receipt.encryptedPayload as EncryptedPayloadWithKeyRef;
    expect(payload.keyId).toBe("ballot");
    expect(payload.keyVersion).toBe(1);
  });

  it("verifyVote succeeds using the embedded key reference", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "ballot");
    const client = new AnonVoteClient({ keyManager: km });
    const election = client.createElection({
      title: "Test",
      description: "d",
      options: ["Yes"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
    const receipt = client.castVote({ ballotId: election.id, voteOption: "Yes" });
    expect(client.verifyVote(receipt.encryptedPayload)).toBe(true);
  });

  it("verifyVote works for a historical vote after key rotation", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "ballot");
    const client = new AnonVoteClient({ keyManager: km });
    const election = client.createElection({
      title: "Test",
      description: "d",
      options: ["Yes"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
    // Encrypt with key v1
    const receipt = client.castVote({ ballotId: election.id, voteOption: "Yes" });
    // Rotate to v2
    km.rotate();
    expect(km.getCurrentKey().metadata.version).toBe(2);
    // Should still verify using the v1 key stored in the payload
    expect(client.verifyVote(receipt.encryptedPayload)).toBe(true);
  });

  it("verifyVote fails if payload keyVersion is not in the manager", () => {
    const km = new SimpleKeyManager(MASTER_KEY, "ballot");
    const client = new AnonVoteClient({ keyManager: km });
    const badPayload = {
      ciphertext: "aa",
      iv: "bb",
      authTag: "cc",
      keyId: "ballot",
      keyVersion: 99, // never derived
    } as EncryptedPayloadWithKeyRef;
    expect(client.verifyVote(badPayload)).toBe(false);
  });
});

// ── Backward compatibility — raw encryptionKey still works ───────────────────

describe("AnonVoteClient backward compatibility", () => {
  const RAW_KEY = "f".repeat(64);

  it("castVote works with a raw encryptionKey (no KeyManager)", () => {
    const client = new AnonVoteClient({ encryptionKey: RAW_KEY });
    const election = client.createElection({
      title: "T",
      description: "d",
      options: ["A"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
    const receipt = client.castVote({ ballotId: election.id, voteOption: "A" });
    expect(receipt.encryptedPayload.ciphertext).toBeTruthy();
    // No key reference fields on legacy payload
    const legacy = receipt.encryptedPayload as EncryptedPayloadWithKeyRef;
    expect(legacy.keyId).toBeUndefined();
  });

  it("verifyVote works with a raw encryptionKey", () => {
    const client = new AnonVoteClient({ encryptionKey: RAW_KEY });
    const election = client.createElection({
      title: "T",
      description: "d",
      options: ["A"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
    const receipt = client.castVote({ ballotId: election.id, voteOption: "A" });
    expect(client.verifyVote(receipt.encryptedPayload)).toBe(true);
  });

  it("derived key is usable directly with encryptVote / decryptVote", () => {
    const keyHex = deriveKey(MASTER_KEY, "ballot", 1);
    const payload = encryptVote("option-a", keyHex);
    const decrypted = decryptVote(payload, keyHex);
    expect(decrypted).toBe("option-a");
  });
});
