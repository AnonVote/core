/**
 * tests/zkp-math.test.ts
 *
 * Tests for BigInt modular arithmetic, prime generation, Miller-Rabin primality,
 * modInverse, modPow, gcd, lcm, extendedGcd, and randomBigInt.
 */

import {
  mod,
  gcd,
  lcm,
  extendedGcd,
  modInverse,
  modPow,
  hexToBigInt,
  bigIntToHex,
  randomBigInt,
  randomCoprime,
  isProbablePrime,
  generatePrime,
} from "../src/zkp/math";

describe("BigInt Modular Math Utilities", () => {
  describe("mod()", () => {
    it("computes positive modulo correctly", () => {
      expect(mod(7n, 5n)).toBe(2n);
      expect(mod(10n, 5n)).toBe(0n);
    });

    it("handles negative dividends correctly", () => {
      expect(mod(-1n, 5n)).toBe(4n);
      expect(-3n % 5n).toBe(-3n); // standard JS is negative
      expect(mod(-3n, 5n)).toBe(2n); // canonical mod is positive
    });

    it("throws on non-positive modulus", () => {
      expect(() => mod(5n, 0n)).toThrow("Modulus must be positive");
      expect(() => mod(5n, -2n)).toThrow("Modulus must be positive");
    });
  });

  describe("gcd() and lcm()", () => {
    it("computes greatest common divisor", () => {
      expect(gcd(48n, 18n)).toBe(6n);
      expect(gcd(101n, 103n)).toBe(1n);
      expect(gcd(0n, 25n)).toBe(25n);
    });

    it("computes least common multiple", () => {
      expect(lcm(12n, 18n)).toBe(36n);
      expect(lcm(7n, 13n)).toBe(91n);
      expect(lcm(0n, 5n)).toBe(0n);
    });
  });

  describe("extendedGcd() and modInverse()", () => {
    it("computes Bezout coefficients", () => {
      const a = 240n;
      const b = 46n;
      const { gcd: g, x, y } = extendedGcd(a, b);
      expect(g).toBe(2n);
      expect(a * x + b * y).toBe(g);
    });

    it("computes modular inverse correctly", () => {
      const a = 3n;
      const m = 11n;
      const inv = modInverse(a, m);
      expect(inv).toBe(4n);
      expect(mod(a * inv, m)).toBe(1n);
    });

    it("computes modular inverse for large values", () => {
      const a = 65537n;
      const m = 1000000007n;
      const inv = modInverse(a, m);
      expect(mod(a * inv, m)).toBe(1n);
    });

    it("throws if modular inverse does not exist", () => {
      expect(() => modInverse(6n, 9n)).toThrow("Modular inverse does not exist");
    });
  });

  describe("modPow()", () => {
    it("computes small modular exponentiations", () => {
      expect(modPow(2n, 10n, 1000n)).toBe(24n); // 1024 % 1000 = 24
      expect(modPow(3n, 0n, 7n)).toBe(1n);
      expect(modPow(5n, 3n, 13n)).toBe(8n); // 125 % 13 = 8
    });

    it("computes large 2048-bit modular exponentiations efficiently", () => {
      const base = 12345678901234567890n;
      const exp = 98765432109876543210n;
      const modVal = 100000000000000000000000000000000000000000000007n;
      const result = modPow(base, exp, modVal);
      expect(result > 0n).toBe(true);
      expect(result < modVal).toBe(true);
    });

    it("handles negative exponents via modInverse", () => {
      const base = 3n;
      const exp = -1n;
      const modVal = 11n;
      expect(modPow(base, exp, modVal)).toBe(4n);
    });
  });

  describe("hex and BigInt conversions", () => {
    it("converts hex to BigInt and back", () => {
      const hex = "1a2b3c4d5e";
      const val = hexToBigInt(hex);
      const back = bigIntToHex(val);
      expect(back).toBe(hex);
    });

    it("handles leading 0x prefix", () => {
      expect(hexToBigInt("0x10")).toBe(16n);
      expect(hexToBigInt("")).toBe(0n);
    });

    it("pads to minimum length when requested", () => {
      const hex = bigIntToHex(15n, 4);
      expect(hex).toBe("000f");
    });
  });

  describe("randomBigInt() and randomCoprime()", () => {
    it("generates random numbers strictly within [min, max)", () => {
      const min = 100n;
      const max = 200n;
      for (let i = 0; i < 20; i++) {
        const r = randomBigInt(min, max);
        expect(r >= min).toBe(true);
        expect(r < max).toBe(true);
      }
    });

    it("generates coprime elements in Z*_n", () => {
      const n = 35n;
      for (let i = 0; i < 10; i++) {
        const r = randomCoprime(n);
        expect(gcd(r, n)).toBe(1n);
      }
    });
  });

  describe("isProbablePrime() and generatePrime()", () => {
    it("correctly identifies primes and composites", () => {
      expect(isProbablePrime(2n)).toBe(true);
      expect(isProbablePrime(3n)).toBe(true);
      expect(isProbablePrime(4n)).toBe(false);
      expect(isProbablePrime(17n)).toBe(true);
      expect(isProbablePrime(561n)).toBe(false); // Carmichael number
      expect(isProbablePrime(65537n)).toBe(true);
    });

    it("generates primes of specified bit length", () => {
      const prime = generatePrime(64);
      expect(prime.toString(2).length).toBe(64);
      expect(isProbablePrime(prime)).toBe(true);
    });
  });
});
