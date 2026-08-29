/**
 * @anonvote/crypto - BigInt Modular Arithmetic & Number Theory Utilities
 *
 * Implements constant-time-friendly modular arithmetic, modular exponentiation,
 * extended Euclidean algorithm, modular inverse, prime generation,
 * Miller-Rabin primality testing, and random BigInt generation.
 */

import { getRandomBytes } from "../random";

/**
 * Computes canonical non-negative modulo: a mod m.
 */
export function mod(a: bigint, m: bigint): bigint {
  if (m <= 0n) {
    throw new Error("Modulus must be positive");
  }
  const result = a % m;
  return result >= 0n ? result : result + m;
}

/**
 * Computes greatest common divisor using Euclidean algorithm.
 */
export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Computes least common multiple: lcm(a, b) = |a * b| / gcd(a, b).
 */
export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  return (absA / gcd(absA, absB)) * absB;
}

/**
 * Extended Euclidean Algorithm.
 * Returns { gcd, x, y } such that a*x + b*y = gcd(a, b).
 */
export function extendedGcd(
  a: bigint,
  b: bigint,
): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const quotient = oldR / r;
    let temp = oldR - quotient * r;
    oldR = r;
    r = temp;

    temp = oldS - quotient * s;
    oldS = s;
    s = temp;

    temp = oldT - quotient * t;
    oldT = t;
    t = temp;
  }

  return { gcd: oldR, x: oldS, y: oldT };
}

/**
 * Computes modular multiplicative inverse: (a^-1) mod m.
 * Throws if inverse does not exist (gcd(a, m) !== 1).
 */
export function modInverse(a: bigint, m: bigint): bigint {
  if (m <= 0n) {
    throw new Error("Modulus must be positive");
  }
  const { gcd: g, x } = extendedGcd(mod(a, m), m);
  if (g !== 1n) {
    throw new Error(`Modular inverse does not exist for a=${a}, m=${m}`);
  }
  return mod(x, m);
}

/**
 * Computes modular exponentiation: (base^exp) mod modulus.
 * Supports arbitrary precision BigInt with logarithmic time complexity.
 */
export function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  if (modulus <= 0n) {
    throw new Error("Modulus must be positive");
  }

  let b = mod(base, modulus);
  let e = exp;

  if (e < 0n) {
    b = modInverse(b, modulus);
    e = -e;
  }

  let result = 1n;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    if (e > 0n) {
      b = (b * b) % modulus;
    }
  }

  return result;
}

/**
 * Converts a hex string to BigInt.
 */
export function hexToBigInt(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return 0n;
  return BigInt("0x" + clean);
}

/**
 * Converts a BigInt to a lowercase hex string (without leading 0x).
 */
export function bigIntToHex(n: bigint, minLength = 0): string {
  if (n < 0n) {
    throw new Error("Negative BigInt hex conversion not supported");
  }
  let hex = n.toString(16).toLowerCase();
  if (hex.length % 2 !== 0) {
    hex = "0" + hex;
  }
  while (hex.length < minLength) {
    hex = "00" + hex;
  }
  return hex;
}

/**
 * Generates a cryptographically secure random BigInt within range [min, max).
 */
export function randomBigInt(min: bigint, max: bigint): bigint {
  if (max <= min) {
    throw new Error("max must be greater than min");
  }
  const range = max - min;
  const bitLength = range.toString(2).length;
  const byteLength = Math.ceil(bitLength / 8);

  while (true) {
    const bytes = getRandomBytes(byteLength);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    const candidate = hexToBigInt(hex);
    // Mask down to bit length to prevent modulo bias
    const mask = (1n << BigInt(bitLength)) - 1n;
    const masked = candidate & mask;
    if (masked < range) {
      return min + masked;
    }
  }
}

/**
 * Generates a random BigInt in Z*_n coprime to n.
 */
export function randomCoprime(n: bigint): bigint {
  while (true) {
    const r = randomBigInt(1n, n);
    if (gcd(r, n) === 1n) {
      return r;
    }
  }
}

/**
 * Miller-Rabin primality test with k rounds.
 */
export function isProbablePrime(n: bigint, rounds = 20): boolean {
  if (n <= 1n) return false;
  if (n <= 3n) return true;
  if ((n & 1n) === 0n) return false;

  // Write n - 1 as 2^s * d
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }

  // Small prime bases for fast composite screening
  const smallPrimes = [
    2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n,
    59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n,
    127n, 131n, 137n, 139n, 149n, 151n, 157n, 163n, 167n, 173n, 179n, 181n,
    191n, 193n, 197n, 199n, 211n, 223n, 227n, 229n, 233n, 239n, 241n, 251n,
  ];
  for (const p of smallPrimes) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  for (let i = 0; i < rounds; i++) {
    const a = randomBigInt(2n, n - 2n);
    let x = modPow(a, d, n);

    if (x === 1n || x === n - 1n) {
      continue;
    }

    let composite = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }

    if (composite) {
      return false;
    }
  }

  return true;
}

/**
 * Generates a probable prime of specified bit length.
 */
export function generatePrime(bits: number): bigint {
  if (bits < 16) {
    throw new Error("Prime bit length must be at least 16");
  }
  const min = 1n << BigInt(bits - 1);
  const max = (1n << BigInt(bits)) - 1n;

  while (true) {
    let candidate = randomBigInt(min, max);
    // Ensure candidate is odd and high bit is set
    candidate |= 1n;
    candidate |= min;

    if (isProbablePrime(candidate, 25)) {
      return candidate;
    }
  }
}
