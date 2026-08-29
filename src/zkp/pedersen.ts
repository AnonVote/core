/**
 * @anonvote/crypto - Pedersen Commitments
 *
 * Implements computationally binding and unconditionally hiding Pedersen commitments
 * over modular prime fields or cyclic subgroups.
 *
 * Homomorphic property:
 * Commit(m1, r1) * Commit(m2, r2) = Commit(m1 + m2, r1 + r2) mod p
 */

import {
  mod,
  modPow,
  generatePrime,
  randomBigInt,
  hexToBigInt,
  bigIntToHex,
} from "./math";
import { ValidationError } from "../errors";

/**
 * Public parameters for Pedersen commitment scheme.
 */
export interface PedersenParams {
  /** Modulus prime p as hex */
  p: string;
  /** Subgroup prime order q where q | (p - 1) as hex */
  q: string;
  /** Generator g as hex */
  g: string;
  /** Generator h where log_g(h) is unknown as hex */
  h: string;
}

/**
 * Pedersen commitment value.
 */
export interface PedersenCommitment {
  /** Commitment value c = g^m * h^r mod p as hex */
  commitment: string;
}

/**
 * Generates public Pedersen commitment parameters.
 *
 * @param bits - Bit size of prime p (e.g. 512 for fast tests, 2048 for high security)
 */
export function generatePedersenParams(bits = 512): PedersenParams {
  const p = generatePrime(bits);
  const q = generatePrime(Math.floor(bits / 2));
  const g = randomBigInt(2n, p - 1n);
  const h = randomBigInt(2n, p - 1n);

  return {
    p: bigIntToHex(p),
    q: bigIntToHex(q),
    g: bigIntToHex(g),
    h: bigIntToHex(h),
  };
}

/**
 * Computes a Pedersen commitment: c = g^m * h^r mod p.
 *
 * @param message - Value to commit to
 * @param blindingFactor - Random secret blinding factor r
 * @param params - Pedersen parameters
 */
export function commitPedersen(
  message: bigint | number,
  blindingFactor: bigint,
  params: PedersenParams,
): PedersenCommitment {
  const p = hexToBigInt(params.p);
  const g = hexToBigInt(params.g);
  const h = hexToBigInt(params.h);

  const m = BigInt(message);
  const gm = modPow(g, m, p);
  const hr = modPow(h, blindingFactor, p);
  const c = mod(gm * hr, p);

  return { commitment: bigIntToHex(c) };
}

/**
 * Verifies that a given commitment matches the opened message and blinding factor.
 */
export function verifyPedersenCommitment(
  commitment: PedersenCommitment,
  message: bigint | number,
  blindingFactor: bigint,
  params: PedersenParams,
): boolean {
  try {
    const expected = commitPedersen(message, blindingFactor, params);
    return expected.commitment.toLowerCase() === commitment.commitment.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Homomorphic addition of two Pedersen commitments:
 * c_sum = c1 * c2 mod p
 * Corresponds to message (m1 + m2) and blinding factor (r1 + r2).
 */
export function addPedersenCommitments(
  c1: PedersenCommitment,
  c2: PedersenCommitment,
  params: PedersenParams,
): PedersenCommitment {
  const p = hexToBigInt(params.p);
  const v1 = hexToBigInt(c1.commitment);
  const v2 = hexToBigInt(c2.commitment);

  if (v1 <= 0n || v2 <= 0n) {
    throw new ValidationError("Invalid commitment values");
  }

  const cSum = mod(v1 * v2, p);
  return { commitment: bigIntToHex(cSum) };
}
