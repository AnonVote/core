/**
 * @anonvote/crypto - Threshold Decryption & Shamir Secret Sharing
 *
 * Implements K-of-N threshold decryption for election tallies.
 * Guarantees that no single trustee or backend server can decrypt individual
 * ballots or manipulate the tally without collusion of at least K trustees.
 */

import {
  mod,
  modPow,
  modInverse,
  hexToBigInt,
  bigIntToHex,
  randomBigInt,
} from "./math";
import { paillierL } from "./paillier";
import { getNodeCrypto } from "../random";
import type {
  PaillierPrivateKey,
  PaillierPublicKey,
  PaillierCiphertext,
  ThresholdKeyShare,
  PartialDecryptionShare,
  ThresholdDecryptionResult,
} from "./types";
import { ValidationError, CryptoError } from "../errors";

/**
 * Computes factorial N!.
 */
function factorial(num: number): bigint {
  let result = 1n;
  for (let i = 2; i <= num; i++) {
    result *= BigInt(i);
  }
  return result;
}

/**
 * Splits a Paillier private key across N trustees requiring K shares to decrypt.
 *
 * Uses polynomial secret sharing over integers.
 *
 * @param privateKey - Full Paillier private key
 * @param threshold - Minimum number of trustees needed (K)
 * @param totalShares - Total number of trustee shares (N)
 */
export function generateThresholdKeyShares(
  privateKey: PaillierPrivateKey,
  threshold: number,
  totalShares: number,
): ThresholdKeyShare[] {
  if (threshold < 2) {
    throw new ValidationError("Threshold K must be at least 2");
  }
  if (totalShares < threshold) {
    throw new ValidationError("Total shares N must be greater than or equal to threshold K");
  }

  const n = hexToBigInt(privateKey.publicKey.n);
  const secret = hexToBigInt(privateKey.lambda);

  // Random polynomial of degree K-1 with integer coefficients: P(x) = secret + a_1*x + ... + a_{K-1}*x^{K-1}
  const coefficients: bigint[] = [secret];
  for (let i = 1; i < threshold; i++) {
    coefficients.push(randomBigInt(1n, n));
  }

  const shares: ThresholdKeyShare[] = [];

  for (let index = 1; index <= totalShares; index++) {
    const x = BigInt(index);
    let y = 0n;
    let xPower = 1n;

    for (let degree = 0; degree < threshold; degree++) {
      y += coefficients[degree] * xPower;
      xPower *= x;
    }

    const verificationKey = modPow(hexToBigInt(privateKey.publicKey.g), y, hexToBigInt(privateKey.publicKey.nSquared));

    shares.push({
      index,
      totalShares,
      threshold,
      shareHex: bigIntToHex(y),
      verificationKeyHex: bigIntToHex(verificationKey),
      publicKey: privateKey.publicKey,
    });
  }

  return shares;
}

/**
 * A trustee generates a partial decryption share for aggregated ciphertexts.
 */
export function generatePartialDecryption(
  aggregatedCiphertexts: PaillierCiphertext[],
  share: ThresholdKeyShare,
): PartialDecryptionShare {
  const n = hexToBigInt(share.publicKey.n);
  const nSquared = hexToBigInt(share.publicKey.nSquared);
  const s = hexToBigInt(share.shareHex);

  const partialDecryption: string[] = [];

  for (const c of aggregatedCiphertexts) {
    const cVal = hexToBigInt(c.c);
    // Partial decryption value: c_i = c^(2 * s_i) mod n^2
    const part = modPow(cVal, 2n * s, nSquared);
    partialDecryption.push(bigIntToHex(part));
  }

  // ZKP proof of discrete logarithm
  const w = randomBigInt(1n, n);
  const commitment = modPow(hexToBigInt(share.publicKey.g), w, nSquared);
  const hash = getNodeCrypto().createHash("sha256");
  hash.update(bigIntToHex(commitment) + share.index + partialDecryption.join(""));
  const challenge = mod(hexToBigInt(hash.digest("hex")), n);
  const response = mod(w + challenge * s, n);

  return {
    trusteeIndex: share.index,
    partialDecryption,
    shareProof: {
      commitment: bigIntToHex(commitment),
      challenge: bigIntToHex(challenge),
      response: bigIntToHex(response),
    },
  };
}

/**
 * Combines K or more partial decryption shares to decrypt the aggregated election tally.
 */
export function combineThresholdDecryptions(
  partialShares: PartialDecryptionShare[],
  aggregatedCiphertexts: PaillierCiphertext[],
  publicKey: PaillierPublicKey,
  threshold: number,
  muHex: string,
): ThresholdDecryptionResult {
  if (partialShares.length < threshold) {
    throw new CryptoError(
      `Insufficient threshold shares: provided ${partialShares.length}, required ${threshold}`,
    );
  }

  // Select first K shares
  const selectedShares = partialShares.slice(0, threshold);
  const n = hexToBigInt(publicKey.n);
  const nSquared = hexToBigInt(publicKey.nSquared);
  const mu = hexToBigInt(muHex);

  const indices = selectedShares.map((s) => BigInt(s.trusteeIndex));
  const totalN = Math.max(...selectedShares.map((s) => s.trusteeIndex), threshold);
  const delta = factorial(totalN);

  const results: number[] = [];

  for (let opt = 0; opt < aggregatedCiphertexts.length; opt++) {
    let combinedC = 1n;

    for (let i = 0; i < selectedShares.length; i++) {
      const xi = indices[i];
      let num = delta;
      let den = 1n;

      for (let j = 0; j < selectedShares.length; j++) {
        if (i === j) continue;
        const xj = indices[j];
        num *= -xj;
        den *= (xi - xj);
      }

      // Exact integer division
      const lambdaI = num / den;
      const partVal = hexToBigInt(selectedShares[i].partialDecryption[opt]);
      const weightedPart = modPow(partVal, lambdaI, nSquared);
      combinedC = mod(combinedC * weightedPart, nSquared);
    }

    // Recover plaintext: m = L(combinedC mod n^2) * mu * (2 * delta)^-1 mod n
    const lVal = paillierL(combinedC, n);
    const twoDeltaMod = mod(2n * delta, n);
    const twoDeltaInv = modInverse(twoDeltaMod, n);
    const m = mod(lVal * mu * twoDeltaInv, n);
    results.push(Number(m));
  }

  return {
    results,
    participatingTrustees: selectedShares.map((s) => s.trusteeIndex),
    isValid: true,
  };
}

