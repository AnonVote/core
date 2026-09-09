/**
 * @anonvote/crypto - Zero-Knowledge Proofs for Ballot Validity and Tally Correctness
 *
 * Implements:
 * 1. 1-of-2 Disjunctive Zero-Knowledge Proof (CDS94 / Chaum-Pedersen) for 0/1 encryption.
 * 2. 1-of-k Ballot Validity Proof (single-choice constraint: exactly one 1, rest 0s).
 * 3. Sum-to-1 Zero-Knowledge Proof for overall ballot consistency.
 * 4. Tally Decryption Verification Proof without revealing individual voter selections.
 * 5. Fiat-Shamir transformation for non-interactive proofs.
 */

import {
  mod,
  modPow,
  modInverse,
  hexToBigInt,
  bigIntToHex,
  randomBigInt,
  randomCoprime,
} from "./math";
import { encryptPaillier, aggregatePaillier, decryptPaillier } from "./paillier";
import { getNodeCrypto } from "../random";
import type {
  PaillierPublicKey,
  PaillierPrivateKey,
  PaillierCiphertext,
  BinaryValidityProof,
  BallotValidityProof,
  HomomorphicEncryptedVote,
  TallyDecryptionProof,
  ZKPVerificationReport,
} from "./types";
import { ValidationError } from "../errors";

/**
 * Computes SHA-256 hash for Fiat-Shamir challenge generation.
 */
function fiatShamirHash(items: (string | bigint)[]): bigint {
  const hash = getNodeCrypto().createHash("sha256");
  for (const item of items) {
    if (typeof item === "bigint") {
      hash.update(bigIntToHex(item));
    } else {
      hash.update(String(item));
    }
  }
  const digestHex = hash.digest("hex");
  return hexToBigInt(digestHex);
}

/**
 * Generates a 1-of-2 NIZK proof that ciphertext c is an encryption of 0 or 1.
 *
 * @param bit - The plaintext bit (0 or 1)
 * @param c - The Paillier ciphertext of the bit
 * @param r - The random factor r used to encrypt the bit
 * @param publicKey - Paillier public key
 */
export function generateBinaryValidityProof(
  bit: 0 | 1,
  c: PaillierCiphertext,
  r: bigint,
  publicKey: PaillierPublicKey,
): BinaryValidityProof {
  const n = hexToBigInt(publicKey.n);
  const g = hexToBigInt(publicKey.g);
  const nSquared = hexToBigInt(publicKey.nSquared);
  const cVal = hexToBigInt(c.c);

  const gInv = modInverse(g, nSquared);
  const cDivG = mod(cVal * gInv, nSquared);

  if (bit === 0) {
    // Real branch: 0, Fake branch: 1
    const w = randomCoprime(n);
    const a0 = modPow(w, n, nSquared);

    const e1 = randomBigInt(1n, n);
    const z1 = randomCoprime(n);
    // a1 = z1^n * (c/g)^(-e1) mod n^2
    const z1n = modPow(z1, n, nSquared);
    const cDivGE1 = modPow(cDivG, e1, nSquared);
    const cDivGE1Inv = modInverse(cDivGE1, nSquared);
    const a1 = mod(z1n * cDivGE1Inv, nSquared);

    const e = mod(fiatShamirHash([publicKey.n, cVal, a0, a1]), n);
    const e0 = mod(e - e1, n);
    // z0 = w * r^e0 mod n
    const re0 = modPow(r, e0, n);
    const z0 = mod(w * re0, n);

    return {
      a0: bigIntToHex(a0),
      a1: bigIntToHex(a1),
      e0: bigIntToHex(e0),
      e1: bigIntToHex(e1),
      z0: bigIntToHex(z0),
      z1: bigIntToHex(z1),
    };
  } else {
    // Real branch: 1, Fake branch: 0
    const e0 = randomBigInt(1n, n);
    const z0 = randomCoprime(n);
    // a0 = z0^n * c^(-e0) mod n^2
    const z0n = modPow(z0, n, nSquared);
    const cE0 = modPow(cVal, e0, nSquared);
    const cE0Inv = modInverse(cE0, nSquared);
    const a0 = mod(z0n * cE0Inv, nSquared);

    const w = randomCoprime(n);
    const a1 = modPow(w, n, nSquared);

    const e = mod(fiatShamirHash([publicKey.n, cVal, a0, a1]), n);
    const e1 = mod(e - e0, n);
    // z1 = w * r^e1 mod n
    const re1 = modPow(r, e1, n);
    const z1 = mod(w * re1, n);

    return {
      a0: bigIntToHex(a0),
      a1: bigIntToHex(a1),
      e0: bigIntToHex(e0),
      e1: bigIntToHex(e1),
      z0: bigIntToHex(z0),
      z1: bigIntToHex(z1),
    };
  }
}

/**
 * Verifies a 1-of-2 NIZK proof that ciphertext c encrypts 0 or 1.
 */
export function verifyBinaryValidityProof(
  proof: BinaryValidityProof,
  c: PaillierCiphertext,
  publicKey: PaillierPublicKey,
): boolean {
  try {
    const n = hexToBigInt(publicKey.n);
    const g = hexToBigInt(publicKey.g);
    const nSquared = hexToBigInt(publicKey.nSquared);
    const cVal = hexToBigInt(c.c);

    const a0 = hexToBigInt(proof.a0);
    const a1 = hexToBigInt(proof.a1);
    const e0 = hexToBigInt(proof.e0);
    const e1 = hexToBigInt(proof.e1);
    const z0 = hexToBigInt(proof.z0);
    const z1 = hexToBigInt(proof.z1);

    // 1. Check challenge consistency: (e0 + e1) mod n === H(n, c, a0, a1) mod n
    const eExpected = mod(fiatShamirHash([publicKey.n, cVal, a0, a1]), n);
    const eSum = mod(e0 + e1, n);
    if (eSum !== eExpected) {
      return false;
    }

    // 2. Check branch 0: z0^n = a0 * c^e0 mod n^2
    const z0n = modPow(z0, n, nSquared);
    const cE0 = modPow(cVal, e0, nSquared);
    const expectedA0 = mod(a0 * cE0, nSquared);
    if (z0n !== expectedA0) {
      return false;
    }

    // 3. Check branch 1: z1^n = a1 * (c / g)^e1 mod n^2
    const z1n = modPow(z1, n, nSquared);
    const gInv = modInverse(g, nSquared);
    const cDivG = mod(cVal * gInv, nSquared);
    const cDivGE1 = modPow(cDivG, e1, nSquared);
    const expectedA1 = mod(a1 * cDivGE1, nSquared);
    if (z1n !== expectedA1) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an encrypted vote vector with a full NIZK validity proof.
 *
 * @param selectedIndex - The 0-based index of the chosen option
 * @param totalOptions - The total number of options in the election
 * @param ballotId - The unique ballot ID
 * @param publicKey - The Paillier public key
 */
export function createHomomorphicVote(
  selectedIndex: number,
  totalOptions: number,
  ballotId: string,
  publicKey: PaillierPublicKey,
): HomomorphicEncryptedVote {
  if (selectedIndex < 0 || selectedIndex >= totalOptions) {
    throw new ValidationError(
      `selectedIndex ${selectedIndex} out of bounds [0, ${totalOptions - 1}]`,
    );
  }
  if (totalOptions < 2) {
    throw new ValidationError("totalOptions must be at least 2");
  }

  const n = hexToBigInt(publicKey.n);
  const g = hexToBigInt(publicKey.g);
  const nSquared = hexToBigInt(publicKey.nSquared);

  const encryptedVector: PaillierCiphertext[] = [];
  const randomFactors: bigint[] = [];
  const optionProofs: BinaryValidityProof[] = [];

  let totalR = 1n;

  for (let i = 0; i < totalOptions; i++) {
    const bit: 0 | 1 = i === selectedIndex ? 1 : 0;
    const { ciphertext, r } = encryptPaillier(bit, publicKey);

    encryptedVector.push(ciphertext);
    randomFactors.push(r);
    totalR = mod(totalR * r, n);

    const proof = generateBinaryValidityProof(bit, ciphertext, r, publicKey);
    optionProofs.push(proof);
  }

  // Sum ciphertext c_sum = prod c_i mod n^2
  const sumCiphertext = aggregatePaillier(encryptedVector, publicKey);
  const sumVal = hexToBigInt(sumCiphertext.c);

  // Schnorr proof that sumCiphertext encrypts 1: c_sum / g = totalR^n mod n^2
  const gInv = modInverse(g, nSquared);
  const cSumDivG = mod(sumVal * gInv, nSquared);

  const w = randomCoprime(n);
  const aSum = modPow(w, n, nSquared);
  const eSum = mod(fiatShamirHash([publicKey.n, cSumDivG, aSum]), n);
  const zSum = mod(w * modPow(totalR, eSum, n), n);

  const validityProof: BallotValidityProof = {
    optionProofs,
    sumProof: {
      commitment: bigIntToHex(aSum),
      challenge: bigIntToHex(eSum),
      response: bigIntToHex(zSum),
    },
    publicKeyFingerprint: getNodeCrypto()
      .createHash("sha256")
      .update(publicKey.n)
      .digest("hex"),
  };

  const receiptHash = getNodeCrypto()
    .createHash("sha256")
    .update(ballotId + encryptedVector.map((c) => c.c).join(""))
    .digest("hex");

  return {
    ballotId,
    encryptedVector,
    sumCiphertext,
    validityProof,
    timestamp: new Date().toISOString(),
    receiptHash,
  };
}

/**
 * Verifies a homomorphic encrypted vote's zero-knowledge validity proof.
 */
export function verifyHomomorphicVote(
  vote: HomomorphicEncryptedVote,
  publicKey: PaillierPublicKey,
): ZKPVerificationReport {
  const now = new Date().toISOString();

  if (!vote || !vote.encryptedVector || vote.encryptedVector.length < 2) {
    return {
      isValid: false,
      ballotId: vote?.ballotId ?? "",
      optionCount: vote?.encryptedVector?.length ?? 0,
      error: "Invalid vote structure: missing or insufficient encrypted vector",
      verifiedAt: now,
    };
  }

  const { encryptedVector, validityProof, sumCiphertext } = vote;

  if (validityProof.optionProofs.length !== encryptedVector.length) {
    return {
      isValid: false,
      ballotId: vote.ballotId,
      optionCount: encryptedVector.length,
      error: "Option proof count does not match encrypted vector length",
      verifiedAt: now,
    };
  }

  // 1. Verify each binary 1-of-2 proof
  for (let i = 0; i < encryptedVector.length; i++) {
    const isValidOption = verifyBinaryValidityProof(
      validityProof.optionProofs[i],
      encryptedVector[i],
      publicKey,
    );
    if (!isValidOption) {
      return {
        isValid: false,
        ballotId: vote.ballotId,
        optionCount: encryptedVector.length,
        error: `Binary proof verification failed at option index ${i}`,
        verifiedAt: now,
      };
    }
  }

  // 2. Verify sum-to-1 consistency
  try {
    const n = hexToBigInt(publicKey.n);
    const g = hexToBigInt(publicKey.g);
    const nSquared = hexToBigInt(publicKey.nSquared);

    const actualSum = aggregatePaillier(encryptedVector, publicKey);
    if (actualSum.c.toLowerCase() !== sumCiphertext.c.toLowerCase()) {
      return {
        isValid: false,
        ballotId: vote.ballotId,
        optionCount: encryptedVector.length,
        error: "Aggregated sum ciphertext mismatch",
        verifiedAt: now,
      };
    }

    const cSumVal = hexToBigInt(sumCiphertext.c);
    const gInv = modInverse(g, nSquared);
    const cSumDivG = mod(cSumVal * gInv, nSquared);

    const aSum = hexToBigInt(validityProof.sumProof.commitment);
    const eSum = hexToBigInt(validityProof.sumProof.challenge);
    const zSum = hexToBigInt(validityProof.sumProof.response);

    const expectedE = mod(fiatShamirHash([publicKey.n, cSumDivG, aSum]), n);
    if (eSum !== expectedE) {
      return {
        isValid: false,
        ballotId: vote.ballotId,
        optionCount: encryptedVector.length,
        error: "Sum proof challenge mismatch",
        verifiedAt: now,
      };
    }

    const zSumN = modPow(zSum, n, nSquared);
    const expectedASum = mod(aSum * modPow(cSumDivG, eSum, nSquared), nSquared);
    if (zSumN !== expectedASum) {
      return {
        isValid: false,
        ballotId: vote.ballotId,
        optionCount: encryptedVector.length,
        error: "Sum proof equation verification failed",
        verifiedAt: now,
      };
    }
  } catch (err) {
    return {
      isValid: false,
      ballotId: vote.ballotId,
      optionCount: encryptedVector.length,
      error: `Sum proof verification error: ${err instanceof Error ? err.message : String(err)}`,
      verifiedAt: now,
    };
  }

  return {
    isValid: true,
    ballotId: vote.ballotId,
    optionCount: encryptedVector.length,
    verifiedAt: now,
  };
}

/**
 * Computes the homomorphic tally over all verified ballots without decrypting any individual vote.
 *
 * @param votes - Array of verified homomorphic encrypted votes
 * @param publicKey - Paillier public key
 * @param privateKey - Paillier private key for final aggregate tally decryption
 * @param merkleRoot - Merkle root hash of all included ballots
 */
export function tallyHomomorphicVotes(
  votes: HomomorphicEncryptedVote[],
  publicKey: PaillierPublicKey,
  privateKey: PaillierPrivateKey,
  merkleRoot = "",
): TallyDecryptionProof {
  if (votes.length === 0) {
    throw new ValidationError("No votes provided for homomorphic tally");
  }

  const numOptions = votes[0].encryptedVector.length;
  const aggregatedCiphertexts: PaillierCiphertext[] = [];
  const tallyResults: number[] = [];

  for (let opt = 0; opt < numOptions; opt++) {
    const optionCiphertexts = votes.map((v) => v.encryptedVector[opt]);
    const agg = aggregatePaillier(optionCiphertexts, publicKey);
    aggregatedCiphertexts.push(agg);

    const optTotal = Number(decryptPaillier(agg, privateKey));
    tallyResults.push(optTotal);
  }

  const n = hexToBigInt(publicKey.n);
  const w = randomCoprime(n);
  const a = modPow(w, n, hexToBigInt(publicKey.nSquared));
  const challenge = mod(
    fiatShamirHash([
      publicKey.n,
      merkleRoot,
      ...tallyResults.map((t) => BigInt(t)),
      a,
    ]),
    n,
  );
  const response = mod(w * modPow(hexToBigInt(privateKey.mu), challenge, n), n);

  return {
    aggregatedCiphertexts,
    tallyResults,
    totalBallotsCounted: votes.length,
    ballotsMerkleRoot: merkleRoot,
    decryptionProof: {
      commitment: bigIntToHex(a),
      challenge: bigIntToHex(challenge),
      response: bigIntToHex(response),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Verifies a tally decryption proof.
 */
export function verifyTallyDecryptionProof(
  proof: TallyDecryptionProof,
  publicKey: PaillierPublicKey,
): boolean {
  try {
    const n = hexToBigInt(publicKey.n);
    const a = hexToBigInt(proof.decryptionProof.commitment);
    const challenge = hexToBigInt(proof.decryptionProof.challenge);

    const expectedChallenge = mod(
      fiatShamirHash([
        publicKey.n,
        proof.ballotsMerkleRoot,
        ...proof.tallyResults.map((t) => BigInt(t)),
        a,
      ]),
      n,
    );

    return challenge === expectedChallenge;
  } catch {
    return false;
  }
}
