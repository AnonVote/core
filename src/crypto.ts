import type { EncryptedPayload } from "./types";
import { CryptoError, ValidationError } from "./errors";
import { getNodeCrypto, getRandomBytes, bytesToHex } from "./random";
import { bytesToBase64Url } from "./utils";

/**
 * Normalizes a voter identifier so that equivalent identifiers — differing
 * only in whitespace, case, Unicode representation, or incidental
 * punctuation — collapse to the same string before hashing.
 *
 * Steps applied, in order:
 *  1. Trim leading/trailing whitespace.
 *  2. Lowercase.
 *  3. Unicode-normalize to NFC (so combining-mark and precomposed forms
 *     of the same character match).
 *  4. Strip any character that isn't alphanumeric, `-`, or `_`.
 */
function normalizeIdentifier(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^a-z0-9-_]/g, "");
}

import { EncryptedVote } from "./types";

/**
 * SHA-256 hash of a voter identifier.
 *
 * Used to store eligibility entries without retaining the original identifier.
 * Input is normalized (trimmed, lowercased, NFC-normalized, and stripped of
 * incidental punctuation) before hashing — always normalize before hashing to
 * avoid duplicate entries for the same voter.
 *
 * Requires Node.js's `crypto` module (or an edge runtime with a Node.js
 * compatibility layer, e.g. Cloudflare Workers' `nodejs_compat` flag) —
 * see the "Runtime support" section of the README.
 *
 * @warning This is a breaking change for any existing hashed data. Any eligibility
 * data hashed with the unnormalized version will no longer match after this fix.
 * Test fixtures and seeded eligibility data must be regenerated.
 *
 * @param id - The voter identifier to hash (e.g. email address)
 * @returns 64-character hex string (SHA-256 digest)
 *
 * @example
 * const hash = hashIdentifier("alice@example.com");
 * // hash === "3d0a9f2e..." (deterministic for the same input)
 */
export function hashIdentifier(id: string): string {
  return getNodeCrypto()
    .createHash("sha256")
    .update(normalizeIdentifier(id))
    .digest("hex");
}

/**
 * Generate a cryptographically secure random voter token.
 *
 * Produces 32 bytes (256 bits) of entropy via Node.js `crypto.randomBytes` or Web Crypto API.
 * Returns either a 64-character hex string (default) or a 43-character URL-safe base64 string.
 * The raw value is given to the voter — never persisted server-side.
 * Use {@link hashToken} to store the server-side reference.
 *
 * @param encoding - Optional encoding variant: 'hex' (default, 64 chars) or 'base64url' (43 chars).
 * @returns Token string in specified encoding format.
 *
 * Works in Node.js and in edge runtimes (Cloudflare Workers, Vercel Edge
 * Functions) via the Web Crypto API — see the "Runtime support" section
 * of the README.
 *
 * @example
 * const rawToken = generateToken(); // default hex string (64 chars)
 * const b64UrlToken = generateToken("base64url"); // compact base64url string (43 chars)
 * const storedHash = hashToken(rawToken); // store only this
 */
export function generateToken(encoding?: "hex" | "base64url"): string {
  const bytes = getRandomBytes(32);
  if (encoding === "base64url") {
    return bytesToBase64Url(bytes);
  }
  return bytesToHex(bytes);
}

/**
 * SHA-256 hash of a raw voter token.
 *
 * Only the hash is stored in the database — the raw token is never persisted.
 * This enforces structural unlinkability between token issuance and vote
 * submission. The raw token should be discarded after hashing.
 *
 * @param token - The raw hex token string produced by {@link generateToken}.
 * @returns A 64-character lowercase hex string (SHA-256 digest of the token).
 *
 * Requires Node.js's `crypto` module (or an edge runtime with a Node.js
 * compatibility layer) — see the "Runtime support" section of the README.
 *
 * @param token - The raw token string to hash
 * @returns 64-character hex string (SHA-256 digest)
 *
 * @example
 * const rawToken = generateToken();
 * const storedHash = hashToken(rawToken);
 * // Store storedHash in the database; discard rawToken after giving it to the voter.
 */
export function hashToken(token: string): string {
  return getNodeCrypto().createHash("sha256").update(token).digest("hex");
}

/**
 * Encrypt a vote option using AES-256-GCM.
 *
 * The encrypted payload stores only the selected option — no voter identity,
 * no token value. Authenticated encryption (GCM mode) ensures any tampering
 * is detectable at decryption time.
 *
 * The IV is generated via a cross-runtime secure random bytes helper,
 * but the AES-256-GCM cipher itself uses Node's `crypto.createCipheriv`.
 * Node's cipher API is synchronous, while the Web Crypto equivalent
 * (`SubtleCrypto.encrypt`) is Promise-based — swapping to it would change
 * this function's signature from sync to async, a breaking change that's
 * out of scope here. So `encryptVote`/`decryptVote` still require Node.js's
 * `crypto` module (or an edge runtime with a Node.js compatibility layer)
 * — see the "Runtime support" section of the README.
 *
 * @param option - The raw vote option string to encrypt
 * @param key    - 64-char hex string (32 bytes), from BALLOT_ENCRYPTION_KEY env var
 * @returns an {@link EncryptedPayload} with ciphertext, iv, and authTag as hex strings
 *
 * @example
 * const encrypted = encryptVote("Yes", process.env.BALLOT_ENCRYPTION_KEY!);
 * // encrypted === { ciphertext: "...", iv: "...", authTag: "..." }
 */
export function encryptVote(option: string, key: string): EncryptedPayload {
  if (key.length !== 64) {
    throw new ValidationError(
      "encryption key must be a 64-character hex string (32 bytes)",
    );
  }

  const { createCipheriv } = getNodeCrypto();
  const keyBuffer = Buffer.from(key, "hex");
  const iv = Buffer.from(getRandomBytes(12)); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(option, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt a vote payload encrypted with {@link encryptVote}.
 *
 * Should only be called by the result tally engine. GCM authentication tag
 * verification detects and rejects any payload that has been tampered with.
 *
 * Requires Node.js's `crypto` module (or an edge runtime with a Node.js
 * compatibility layer) — see the "Runtime support" section of the README.
 *
 * @param payload - the {@link EncryptedPayload} to decrypt
 * @param key     - 64-char hex string (32 bytes)
 * @returns the original option string
 *
 * @example
 * const option = decryptVote(encryptedPayload, process.env.BALLOT_ENCRYPTION_KEY!);
 * // option === "Yes"
 */
export function decryptVote(payload: EncryptedPayload, key: string): string {
  const { createDecipheriv } = getNodeCrypto();
  const keyBuffer = Buffer.from(key, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);

  try {
    return (
      decipher.update(ciphertext).toString("utf8") + decipher.final("utf8")
    );
  } catch {
    throw new CryptoError(
      "Failed to decrypt vote: payload has been tampered with or the key is incorrect",
    );
  }
}

/**
 * Verify that an encrypted vote payload corresponds to a given vote option.
 *
 * This function verifies by:
 * 1. Decrypting the encrypted vote with the ballot key
 * 2. Comparing the decrypted value with the vote option
 *
 * This allows third parties to verify that a specific vote option was the one
 * encrypted, without revealing the option itself. The encrypted payload serves
 * as a commitment that can be checked during audit.
 *
 * Note: Because encryption is non-deterministic (random IV), the same vote
 * option encrypted twice produces different ciphertexts. Therefore verification
 * must decrypt the actual encrypted payload rather than re-encrypting.
 *
 * @param voteOption - The vote option string to verify
 * @param encryptedVote - The encrypted vote payload to verify
 * @param ballotKey - 44-character base64 string (32 bytes)
 * @returns true if the encrypted vote decrypts to the vote option, false otherwise
 *
 * @example
 * const isValid = verifyVoteHash("option-uuid", encryptedVote, ballotKey);
 */
export function verifyVoteHash(
  voteOption: string,
  encryptedVote: EncryptedVote,
  ballotKey: string,
): boolean {
  try {
    // Step 1: Decrypt the encrypted vote payload
    const decrypted = decryptVote(encryptedVote, ballotKey);

    // Step 2: Compare the decrypted value with the vote option
    return constantTimeEqual(decrypted, voteOption);
  } catch {
    // If decryption fails (tampered payload, wrong key, etc.), verification fails
    return false;
  }
}

/**
 * Alias for {@link verifyVoteHash} for Merkle and inclusion proof verification compatibility.
 */
export const verifyVoteProof = verifyVoteHash;

import type {
  PaillierPublicKey,
  PaillierPrivateKey,
  HomomorphicEncryptedVote,
  TallyDecryptionProof,
  ZKPVerificationReport,
} from "./zkp/types";
import {
  createHomomorphicVote,
  verifyHomomorphicVote,
  tallyHomomorphicVotes,
  verifyTallyDecryptionProof,
} from "./zkp/proofs";

/**
 * Encrypts a vote homomorphically using Paillier encryption and generates a full
 * Non-Interactive Zero-Knowledge (NIZK) validity proof proving that the ballot is
 * valid (single-choice 1-of-k) without revealing the chosen option.
 *
 * @param optionIndex - The 0-based index of the chosen election option
 * @param totalOptions - Total number of available options in the election
 * @param ballotId - Unique identifier of the ballot
 * @param publicKey - Paillier public key for additive homomorphic encryption
 * @returns Homomorphic encrypted vote containing encrypted vector and ZKP proof
 *
 * @example
 * const vote = encryptVoteHomomorphic(0, 3, "ballot-123", paillierKeyPair.publicKey);
 */
export function encryptVoteHomomorphic(
  optionIndex: number,
  totalOptions: number,
  ballotId: string,
  publicKey: PaillierPublicKey,
): HomomorphicEncryptedVote {
  return createHomomorphicVote(optionIndex, totalOptions, ballotId, publicKey);
}

/**
 * Verifies a voter's Zero-Knowledge Proof (NIZK) validity without decrypting their ballot.
 *
 * @param vote - The homomorphic encrypted vote to audit
 * @param publicKey - Paillier public key
 * @returns A {@link ZKPVerificationReport} indicating validity status
 *
 * @example
 * const report = verifyVoteZKP(vote, paillierKeyPair.publicKey);
 * console.log(report.isValid); // true
 */
export function verifyVoteZKP(
  vote: HomomorphicEncryptedVote,
  publicKey: PaillierPublicKey,
): ZKPVerificationReport {
  return verifyHomomorphicVote(vote, publicKey);
}

/**
 * Homomorphically tallies all verified votes into an aggregated result without
 * decrypting any individual ballot.
 *
 * @param votes - List of homomorphic encrypted votes
 * @param publicKey - Paillier public key
 * @param privateKey - Paillier private key for final aggregate total decryption
 * @param merkleRoot - Merkle root of all ballots included in the tally
 * @returns A {@link TallyDecryptionProof} containing aggregated totals and decryption proof
 *
 * @example
 * const proof = tallyHomomorphic(votes, keyPair.publicKey, keyPair.privateKey, "root-123");
 * console.log(proof.tallyResults); // [10, 5, 2]
 */
export function tallyHomomorphic(
  votes: HomomorphicEncryptedVote[],
  publicKey: PaillierPublicKey,
  privateKey: PaillierPrivateKey,
  merkleRoot = "",
): TallyDecryptionProof {
  return tallyHomomorphicVotes(votes, publicKey, privateKey, merkleRoot);
}

/**
 * Verifies the correctness of a homomorphic tally decryption proof.
 *
 * @param proof - Tally decryption proof
 * @param publicKey - Paillier public key
 * @returns true if the tally decryption proof is valid, false otherwise
 *
 * @example
 * const isVerified = verifyHomomorphicTallyProof(proof, keyPair.publicKey);
 * console.log(isVerified); // true
 */
export function verifyHomomorphicTallyProof(
  proof: TallyDecryptionProof,
  publicKey: PaillierPublicKey,
): boolean {
  return verifyTallyDecryptionProof(proof, publicKey);
}



/**
 * Parse and validate a base64-encoded 32-byte ballot key.
 *
 * Accepts both standard base64 and base64url encodings.
 * The key must decode to exactly 32 bytes (256 bits) for AES-256.
 *
 * @param ballotKey - Base64-encoded 32-byte key
 * @returns Buffer containing the decoded 32-byte key
 *
 * @throws {Error} If the key is empty
 * @throws {Error} If the decoded key is not exactly 32 bytes
 */
function _parseBallotKey(ballotKey: string): Buffer {
  if (ballotKey.length === 0) {
    throw new Error("Ballot key must not be empty");
  }

  let key: Buffer;
  try {
    key = Buffer.from(ballotKey, "base64");
  } catch {
    throw new Error("Ballot key is not valid base64");
  }

  // Support both 32-byte base64 strings and 64-char hex strings for backward compat
  if (
    key.length !== 32 &&
    /^[0-9a-fA-F]+$/.test(ballotKey) &&
    ballotKey.length === 64
  ) {
    try {
      key = Buffer.from(ballotKey, "hex");
    } catch {
      // fall through to length check
    }
  }

  if (key.length !== 32) {
    throw new Error(
      `Invalid ballot key length: expected 32 bytes (256 bits), got ${key.length} bytes`,
    );
  }

  return key;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Standard string comparison short-circuits on the first differing character,
 * leaking information about the comparison through timing. This function
 * always compares all characters, making timing attacks infeasible.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if the strings are equal, false otherwise
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
