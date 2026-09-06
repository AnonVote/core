/**
 * @anonvote/crypto - Paillier Additive Homomorphic Cryptosystem
 *
 * Implements key generation, probabilistic encryption, additive homomorphism,
 * scalar multiplication, and decryption under the Paillier cryptosystem.
 *
 * Homomorphic properties:
 * - D(Enc(m1) * Enc(m2) mod n^2) = (m1 + m2) mod n
 * - D(Enc(m1)^k mod n^2) = (k * m1) mod n
 */

import {
  mod,
  modPow,
  modInverse,
  lcm,
  generatePrime,
  randomCoprime,
  hexToBigInt,
  bigIntToHex,
} from "./math";
import type {
  PaillierPublicKey,
  PaillierPrivateKey,
  PaillierKeyPair,
  PaillierCiphertext,
} from "./types";
import { CryptoError, ValidationError } from "../errors";

/**
 * Paillier L function: L(u, n) = (u - 1) / n.
 */
export function paillierL(u: bigint, n: bigint): bigint {
  return (u - 1n) / n;
}

/**
 * Generates a Paillier key pair of specified bit length (e.g. 2048, 3072, 4096).
 *
 * @param bits - Key length in bits (default 2048 for production security; smaller sizes like 128/256/512 only for fast testing).
 * @throws {ValidationError} If bits < 64.
 */
export function generatePaillierKeyPair(bits = 2048): PaillierKeyPair {
  if (bits < 64) {
    throw new ValidationError("Paillier key bit length must be at least 64 bits");
  }

  const primeBits = Math.floor(bits / 2);
  let p = generatePrime(primeBits);
  let q = generatePrime(primeBits);

  while (p === q) {
    q = generatePrime(primeBits);
  }

  const n = p * q;
  const nSquared = n * n;
  const g = n + 1n; // Standard Paillier optimization: g = n + 1 simplifies L(g^lambda mod n^2)

  const lambda = lcm(p - 1n, q - 1n);
  // Compute mu = (L(g^lambda mod n^2))^-1 mod n
  const gLambda = modPow(g, lambda, nSquared);
  const lVal = paillierL(gLambda, n);
  const mu = modInverse(lVal, n);

  const publicKey: PaillierPublicKey = {
    n: bigIntToHex(n),
    g: bigIntToHex(g),
    nSquared: bigIntToHex(nSquared),
    bits,
  };

  const privateKey: PaillierPrivateKey = {
    lambda: bigIntToHex(lambda),
    mu: bigIntToHex(mu),
    publicKey,
  };

  return { publicKey, privateKey };
}

/**
 * Encrypts a plaintext message m using Paillier public key:
 * c = g^m * r^n mod n^2 where r is a random element in Z*_n.
 *
 * @param message - Plaintext integer as bigint or number
 * @param publicKey - Paillier public key
 * @param randomR - Optional explicit randomness r in Z*_n (useful for ZKP proofs)
 */
export function encryptPaillier(
  message: bigint | number,
  publicKey: PaillierPublicKey,
  randomR?: bigint,
): { ciphertext: PaillierCiphertext; r: bigint } {
  const n = hexToBigInt(publicKey.n);
  const g = hexToBigInt(publicKey.g);
  const nSquared = hexToBigInt(publicKey.nSquared);

  const m = BigInt(message);
  if (m < 0n || m >= n) {
    throw new ValidationError(`Message must be in range [0, n-1]`);
  }

  const r = randomR ?? randomCoprime(n);
  const gm = modPow(g, m, nSquared);
  const rn = modPow(r, n, nSquared);
  const c = mod(gm * rn, nSquared);

  return {
    ciphertext: { c: bigIntToHex(c) },
    r,
  };
}

/**
 * Decrypts a Paillier ciphertext using private key:
 * m = L(c^lambda mod n^2) * mu mod n.
 *
 * @param ciphertext - Paillier ciphertext
 * @param privateKey - Paillier private key
 */
export function decryptPaillier(
  ciphertext: PaillierCiphertext,
  privateKey: PaillierPrivateKey,
): bigint {
  const n = hexToBigInt(privateKey.publicKey.n);
  const nSquared = hexToBigInt(privateKey.publicKey.nSquared);
  const lambda = hexToBigInt(privateKey.lambda);
  const mu = hexToBigInt(privateKey.mu);
  const c = hexToBigInt(ciphertext.c);

  if (c <= 0n || c >= nSquared) {
    throw new CryptoError("Invalid ciphertext: out of range [1, n^2 - 1]");
  }

  const cLambda = modPow(c, lambda, nSquared);
  const lVal = paillierL(cLambda, n);
  const m = mod(lVal * mu, n);

  return m;
}

/**
 * Adds two Paillier ciphertexts homomorphically without decryption:
 * c_sum = c1 * c2 mod n^2
 * Decryption yields (m1 + m2) mod n.
 */
export function addPaillier(
  c1: PaillierCiphertext,
  c2: PaillierCiphertext,
  publicKey: PaillierPublicKey,
): PaillierCiphertext {
  const nSquared = hexToBigInt(publicKey.nSquared);
  const c1Val = hexToBigInt(c1.c);
  const c2Val = hexToBigInt(c2.c);

  const cSum = mod(c1Val * c2Val, nSquared);
  return { c: bigIntToHex(cSum) };
}

/**
 * Homomorphically aggregates an array of Paillier ciphertexts:
 * c_total = prod_{i=1}^k c_i mod n^2.
 */
export function aggregatePaillier(
  ciphertexts: PaillierCiphertext[],
  publicKey: PaillierPublicKey,
): PaillierCiphertext {
  if (ciphertexts.length === 0) {
    // Encrypt 0 with r = 1 => c = 1
    return { c: bigIntToHex(1n) };
  }

  const nSquared = hexToBigInt(publicKey.nSquared);
  let total = hexToBigInt(ciphertexts[0].c);

  for (let i = 1; i < ciphertexts.length; i++) {
    const nextVal = hexToBigInt(ciphertexts[i].c);
    total = (total * nextVal) % nSquared;
  }

  return { c: bigIntToHex(total) };
}

/**
 * Multiplies a Paillier ciphertext by a plaintext scalar:
 * c_mult = c^scalar mod n^2
 * Decryption yields (scalar * m) mod n.
 */
export function multiplyPaillier(
  ciphertext: PaillierCiphertext,
  scalar: bigint | number,
  publicKey: PaillierPublicKey,
): PaillierCiphertext {
  const nSquared = hexToBigInt(publicKey.nSquared);
  const cVal = hexToBigInt(ciphertext.c);
  const s = BigInt(scalar);

  const cMult = modPow(cVal, s, nSquared);
  return { c: bigIntToHex(cMult) };
}
