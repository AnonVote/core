/**
 * org-crypto + commitment tests — Issue #86.
 *
 * These run against real noble crypto (no mocks); that is precisely why the
 * implementation is all-noble rather than WebCrypto, which jsdom lacks.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  deriveOrgKeypair,
  encryptDescription,
  decryptDescription,
  parseEnvelope,
  toBase64,
  fromBase64,
} from "../utils/org-crypto";
import {
  canonicalBallotPayload,
  computeBallotCommitment,
  hashDescription,
} from "../utils/commitment";
import {
  cacheOrgKey,
  getCachedOrgKey,
  clearOrgKey,
  deriveAndCacheOrgKey,
} from "../hooks/useOrgKey";

const SALT = toBase64(new Uint8Array(16).fill(7));
const PASSWORD = "correct horse battery staple";

describe("key derivation", () => {
  it("is deterministic for the same password and salt", () => {
    const a = deriveOrgKeypair(PASSWORD, SALT);
    const b = deriveOrgKeypair(PASSWORD, SALT);
    expect(a.publicKeyBase64).toBe(b.publicKeyBase64);
    expect(Array.from(a.privateKey)).toEqual(Array.from(b.privateKey));
  });

  it("produces a different key for a different password", () => {
    const a = deriveOrgKeypair(PASSWORD, SALT);
    const b = deriveOrgKeypair(PASSWORD + "!", SALT);
    expect(a.publicKeyBase64).not.toBe(b.publicKeyBase64);
  });

  it("produces a different key for a different salt", () => {
    const other = toBase64(new Uint8Array(16).fill(9));
    expect(deriveOrgKeypair(PASSWORD, SALT).publicKeyBase64).not.toBe(
      deriveOrgKeypair(PASSWORD, other).publicKeyBase64,
    );
  });

  it("emits a 32-byte raw public key (44 base64 chars)", () => {
    const { publicKey, publicKeyBase64 } = deriveOrgKeypair(PASSWORD, SALT);
    expect(publicKey).toHaveLength(32);
    expect(publicKeyBase64).toHaveLength(44);
  });

  it("rejects missing inputs", () => {
    expect(() => deriveOrgKeypair("", SALT)).toThrow();
    expect(() => deriveOrgKeypair(PASSWORD, "")).toThrow();
  });
});

describe("ECDH encrypt/decrypt", () => {
  it("round-trips a description", () => {
    const { privateKey, publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const plaintext = "Budget allocation for FY2027 — confidential.";

    const envelope = encryptDescription(plaintext, publicKey);
    expect(decryptDescription(envelope, privateKey)).toBe(plaintext);
  });

  it("accepts a base64 public key as well as raw bytes", () => {
    const { privateKey, publicKeyBase64 } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("hello", publicKeyBase64);
    expect(decryptDescription(envelope, privateKey)).toBe("hello");
  });

  it("produces a fresh ephemeral key per call", () => {
    const { publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const a = encryptDescription("same text", publicKey);
    const b = encryptDescription("same text", publicKey);
    expect(a).not.toBe(b);
    expect(parseEnvelope(a).ephemeralPublicKey).not.toEqual(
      parseEnvelope(b).ephemeralPublicKey,
    );
  });

  it("fails with the wrong key", () => {
    const org = deriveOrgKeypair(PASSWORD, SALT);
    const other = deriveOrgKeypair("a different password", SALT);
    const envelope = encryptDescription("secret", org.publicKey);
    expect(() => decryptDescription(envelope, other.privateKey)).toThrow();
  });

  it("fails on tampered ciphertext", () => {
    const { privateKey, publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("secret", publicKey);
    const parts = envelope.split(":");

    const ct = fromBase64(parts[3]);
    ct[0] ^= 0xff; // flip a bit — AES-GCM must reject it
    parts[3] = toBase64(ct);

    expect(() => decryptDescription(parts.join(":"), privateKey)).toThrow();
  });

  it("round-trips unicode and empty strings", () => {
    const { privateKey, publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    for (const text of ["", "Ünïcødé — 🗳️ ballot", "x".repeat(5000)]) {
      const envelope = encryptDescription(text, publicKey);
      expect(decryptDescription(envelope, privateKey)).toBe(text);
    }
  });
});

describe("envelope parsing", () => {
  it("parses a v1 envelope into its three parts", () => {
    const { publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("hi", publicKey);

    expect(envelope.startsWith("v1:")).toBe(true);
    const parsed = parseEnvelope(envelope);
    expect(parsed.ephemeralPublicKey).toHaveLength(32);
    expect(parsed.iv).toHaveLength(12);
    expect(parsed.ciphertext.length).toBeGreaterThan(0);
  });

  it("rejects an unknown or malformed envelope", () => {
    expect(() => parseEnvelope("not-an-envelope")).toThrow();
    expect(() => parseEnvelope("v2:a:b:c")).toThrow();
    expect(() => parseEnvelope("v1:a:b")).toThrow();
  });
});

describe("commitment parity with the backend", () => {
  // Shared fixture — the backend suite asserts the identical value.
  const FIXTURE = {
    topic: "  Annual budget vote  ",
    descriptionHash: "a".repeat(64),
    options: [{ text: "Charlie" }, { text: " Alpha " }, { text: "Bravo" }],
    deadline: "2027-01-15T12:00:00.000Z",
  };

  it("canonicalizes deterministically with trimmed, sorted options", () => {
    const parsed = JSON.parse(canonicalBallotPayload(FIXTURE));
    expect(parsed.topic).toBe("Annual budget vote");
    expect(parsed.options).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(parsed.deadline).toBe("2027-01-15T12:00:00.000Z");
  });

  it("matches the backend hash for the shared fixture", () => {
    // Value produced by backend/src/utils/commitment.ts for FIXTURE.
    expect(computeBallotCommitment(FIXTURE)).toBe(
      "28abb03f3022d54e827d2a4215945ddfb4df0e698e9815300289470bf403997c",
    );
  });

  it("survives re-encryption of an identical description", () => {
    // Regression: the commitment used to cover the ciphertext. Encrypting the
    // same text twice yields different envelopes, so a routine password-change
    // re-encryption permanently invalidated an already-anchored, write-once
    // commitment. Committing the plaintext hash fixes that.
    const { publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const text = "Board-only context";

    const first = encryptDescription(text, publicKey);
    const second = encryptDescription(text, publicKey);
    expect(first).not.toBe(second); // different envelopes, same content

    const base = {
      topic: "Stable",
      options: [{ text: "A" }, { text: "B" }],
      deadline: "2027-01-15T12:00:00.000Z",
    };
    expect(
      computeBallotCommitment({ ...base, descriptionHash: hashDescription(text) }),
    ).toBe(
      computeBallotCommitment({ ...base, descriptionHash: hashDescription(text) }),
    );
  });

  it("changes when the description content actually changes", () => {
    const base = {
      topic: "Stable",
      options: [{ text: "A" }, { text: "B" }],
      deadline: "2027-01-15T12:00:00.000Z",
    };
    expect(
      computeBallotCommitment({ ...base, descriptionHash: hashDescription("one") }),
    ).not.toBe(
      computeBallotCommitment({ ...base, descriptionHash: hashDescription("two") }),
    );
  });

  it("is independent of option ordering", () => {
    const a = computeBallotCommitment(FIXTURE);
    const b = computeBallotCommitment({
      ...FIXTURE,
      options: [{ text: "Bravo" }, { text: "Charlie" }, { text: " Alpha " }],
    });
    expect(a).toBe(b);
  });

  it("treats a null ciphertext as empty, so legacy ballots hash", () => {
    const base = {
      topic: "Legacy",
      options: [{ text: "A" }, { text: "B" }],
      deadline: "2027-01-15T12:00:00.000Z",
    };
    expect(computeBallotCommitment({ ...base, descriptionHash: null })).toBe(
      computeBallotCommitment({ ...base, descriptionHash: "" }),
    );
  });
});

describe("useOrgKey cache", () => {
  beforeEach(() => {
    clearOrgKey();
  });

  it("returns null when nothing is cached", () => {
    expect(getCachedOrgKey()).toBeNull();
  });

  it("round-trips a cached key", () => {
    const { privateKey } = deriveOrgKeypair(PASSWORD, SALT);
    cacheOrgKey(privateKey);
    expect(Array.from(getCachedOrgKey()!)).toEqual(Array.from(privateKey));
  });

  it("derives, caches, and returns the public key for enrollment", () => {
    const publicKeyBase64 = deriveAndCacheOrgKey(PASSWORD, SALT);
    expect(publicKeyBase64).toBe(
      deriveOrgKeypair(PASSWORD, SALT).publicKeyBase64,
    );
    expect(getCachedOrgKey()).not.toBeNull();
  });

  it("clears the key on logout", () => {
    cacheOrgKey(deriveOrgKeypair(PASSWORD, SALT).privateKey);
    clearOrgKey();
    expect(getCachedOrgKey()).toBeNull();
  });
});
