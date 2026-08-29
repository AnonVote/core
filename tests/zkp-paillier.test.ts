/**
 * tests/zkp-paillier.test.ts
 *
 * Tests for Paillier additive homomorphic cryptosystem.
 */

import {
  generatePaillierKeyPair,
  encryptPaillier,
  decryptPaillier,
  addPaillier,
  aggregatePaillier,
  multiplyPaillier,
} from "../src/zkp/paillier";

describe("Paillier Additive Homomorphic Cryptosystem", () => {
  const keyPair = generatePaillierKeyPair(128); // Fast key size for unit tests

  it("generates a valid Paillier key pair", () => {
    expect(keyPair.publicKey).toHaveProperty("n");
    expect(keyPair.publicKey).toHaveProperty("g");
    expect(keyPair.publicKey).toHaveProperty("nSquared");
    expect(keyPair.privateKey).toHaveProperty("lambda");
    expect(keyPair.privateKey).toHaveProperty("mu");
    expect(keyPair.publicKey.bits).toBe(128);
  });

  it("encrypts and decrypts a plaintext message", () => {
    const message = 42n;
    const { ciphertext } = encryptPaillier(message, keyPair.publicKey);
    const decrypted = decryptPaillier(ciphertext, keyPair.privateKey);
    expect(decrypted).toBe(message);
  });

  it("encrypts and decrypts 0 and 1", () => {
    const { ciphertext: c0 } = encryptPaillier(0, keyPair.publicKey);
    const { ciphertext: c1 } = encryptPaillier(1, keyPair.publicKey);

    expect(decryptPaillier(c0, keyPair.privateKey)).toBe(0n);
    expect(decryptPaillier(c1, keyPair.privateKey)).toBe(1n);
  });

  it("is probabilistic (semantic security): encrypting the same message twice produces different ciphertexts", () => {
    const { ciphertext: c1 } = encryptPaillier(5, keyPair.publicKey);
    const { ciphertext: c2 } = encryptPaillier(5, keyPair.publicKey);

    expect(c1.c).not.toBe(c2.c);
    expect(decryptPaillier(c1, keyPair.privateKey)).toBe(5n);
    expect(decryptPaillier(c2, keyPair.privateKey)).toBe(5n);
  });

  it("supports additive homomorphism: D(c1 * c2 mod n^2) = m1 + m2", () => {
    const m1 = 15n;
    const m2 = 27n;

    const { ciphertext: c1 } = encryptPaillier(m1, keyPair.publicKey);
    const { ciphertext: c2 } = encryptPaillier(m2, keyPair.publicKey);

    const cSum = addPaillier(c1, c2, keyPair.publicKey);
    const decryptedSum = decryptPaillier(cSum, keyPair.privateKey);

    expect(decryptedSum).toBe(m1 + m2);
  });

  it("aggregates an array of ciphertexts homomorphically", () => {
    const votes = [1, 0, 1, 1, 0, 1, 1, 0, 1]; // sum = 6
    const ciphertexts = votes.map((v) => encryptPaillier(v, keyPair.publicKey).ciphertext);

    const aggregated = aggregatePaillier(ciphertexts, keyPair.publicKey);
    const decrypted = decryptPaillier(aggregated, keyPair.privateKey);

    expect(decrypted).toBe(6n);
  });

  it("supports scalar multiplication: D(c^k mod n^2) = k * m", () => {
    const message = 7n;
    const scalar = 4n;

    const { ciphertext } = encryptPaillier(message, keyPair.publicKey);
    const cMult = multiplyPaillier(ciphertext, scalar, keyPair.publicKey);
    const decrypted = decryptPaillier(cMult, keyPair.privateKey);

    expect(decrypted).toBe(message * scalar);
  });

  it("rejects invalid messages out of modulus bounds", () => {
    expect(() => encryptPaillier(-1n, keyPair.publicKey)).toThrow();
  });

  it("detects tampered ciphertext during decryption", () => {
    const tampered = { c: "00000000" };
    expect(() => decryptPaillier(tampered, keyPair.privateKey)).toThrow();
  });
});
