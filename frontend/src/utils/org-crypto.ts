/**
 * Organization end-to-end encryption for ballot descriptions (Issue #86).
 *
 * The organization's X25519 private key is derived in the browser from the
 * admin's password and a public, server-generated salt. The server never
 * receives it — it only ever stores the corresponding public key.
 *
 * Scheme:
 *   seed    = PBKDF2-HMAC-SHA256(password, salt, 210_000, 32)
 *   privKey = HKDF-SHA256(seed, salt, "anonvote-org-x25519-v1", 32)
 *   pubKey  = x25519.getPublicKey(privKey)
 *
 *   encrypt(plaintext, orgPubKey):
 *     ephPriv, ephPub = fresh random x25519 keypair, one per ballot
 *     shared     = x25519.getSharedSecret(ephPriv, orgPubKey)
 *     contentKey = HKDF-SHA256(shared, "", INFO || ephPub || orgPubKey, 32)
 *     envelope   = "v1:" + b64(ephPub) + ":" + b64(iv) + ":" + b64(ciphertext)
 *
 * Binding `ephPub || orgPubKey` into the HKDF info is deliberate: it prevents
 * unknown-key-share and key-reuse attacks. The "v1:" prefix makes the envelope
 * self-describing so the scheme can be rotated later.
 *
 * All-noble rather than WebCrypto: WebCrypto's X25519 is recent (Chrome 133+,
 * Safari 17+) and absent from jsdom, which would force the tests to mock the
 * very code they are meant to exercise.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

const PBKDF2_ITERATIONS = 210_000; // OWASP guidance for HMAC-SHA256
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

const KEY_INFO = "anonvote-org-x25519-v1";
const CONTENT_INFO = "anonvote-ballot-desc-v1";

export const ENVELOPE_VERSION = "v1";

// ── encoding helpers ────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ── key derivation ──────────────────────────────────────────────────────────

export interface OrgKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** Base64 of the raw public key — the form the server stores. */
  publicKeyBase64: string;
}

/**
 * Derives the organization keypair from the admin password and the server's salt.
 * Deterministic: the same inputs always yield the same keypair.
 */
export function deriveOrgKeypair(
  password: string,
  saltBase64: string,
): OrgKeypair {
  if (!password) throw new Error("org-crypto: password is required");
  if (!saltBase64) throw new Error("org-crypto: keyDerivationSalt is required");

  const salt = fromBase64(saltBase64);

  const seed = pbkdf2(sha256, utf8.encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH,
  });

  const privateKey = hkdf(sha256, seed, salt, utf8.encode(KEY_INFO), KEY_LENGTH);
  const publicKey = x25519.getPublicKey(privateKey);

  return { privateKey, publicKey, publicKeyBase64: toBase64(publicKey) };
}

// ── envelope ────────────────────────────────────────────────────────────────

export interface ParsedEnvelope {
  ephemeralPublicKey: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("org-crypto: unrecognised envelope format");
  }
  return {
    ephemeralPublicKey: fromBase64(parts[1]),
    iv: fromBase64(parts[2]),
    ciphertext: fromBase64(parts[3]),
  };
}

function deriveContentKey(
  shared: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  orgPublicKey: Uint8Array,
): Uint8Array {
  return hkdf(
    sha256,
    shared,
    new Uint8Array(0),
    concat(utf8.encode(CONTENT_INFO), ephemeralPublicKey, orgPublicKey),
    KEY_LENGTH,
  );
}

/**
 * Encrypts a description to the organization's public key.
 * A fresh ephemeral keypair is generated per call, so the same plaintext
 * encrypted twice produces different envelopes.
 */
export function encryptDescription(
  plaintext: string,
  orgPublicKey: Uint8Array | string,
): string {
  const orgPub =
    typeof orgPublicKey === "string" ? fromBase64(orgPublicKey) : orgPublicKey;

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const shared = x25519.getSharedSecret(ephemeralPrivateKey, orgPub);

  const contentKey = deriveContentKey(shared, ephemeralPublicKey, orgPub);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = gcm(contentKey, iv).encrypt(utf8.encode(plaintext));

  return [
    ENVELOPE_VERSION,
    toBase64(ephemeralPublicKey),
    toBase64(iv),
    toBase64(ciphertext),
  ].join(":");
}

/**
 * Decrypts a description with the organization's private key.
 * Throws if the envelope is malformed, the key is wrong, or the ciphertext has
 * been tampered with (AES-GCM authentication failure).
 */
export function decryptDescription(
  envelope: string,
  privateKey: Uint8Array,
): string {
  const { ephemeralPublicKey, iv, ciphertext } = parseEnvelope(envelope);

  const orgPublicKey = x25519.getPublicKey(privateKey);
  const shared = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
  const contentKey = deriveContentKey(shared, ephemeralPublicKey, orgPublicKey);

  return utf8Decode.decode(gcm(contentKey, iv).decrypt(ciphertext));
}
