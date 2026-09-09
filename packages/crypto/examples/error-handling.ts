/**
 * error-handling.ts
 *
 * Demonstrates proper error handling with @anonvote/crypto:
 *   1. Catching ValidationError for invalid inputs
 *   2. Catching CryptoError for tampered payloads
 *   3. Using the error hierarchy (AnonVoteError base class)
 *   4. Extracting useful error information
 *
 * Run with: npx tsx examples/error-handling.ts
 */

import { encryptVote, decryptVote } from "../src/crypto";
import { AnonVoteError, ValidationError, CryptoError } from "../src/errors";
import { AnonVoteClient } from "../src/client";

const VALID_KEY = "a".repeat(64);
const WRONG_KEY = "b".repeat(64);

export interface ErrorTestResult {
  name: string;
  caught: boolean;
  errorType: string;
  message: string;
}

export function main(): ErrorTestResult[] {
  const results: ErrorTestResult[] = [];

  // ── 1. ValidationError: invalid encryption key ────────────────────────
  console.log("--- Test 1: Invalid key length ---");
  try {
    encryptVote("Yes", "tooshort");
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      results.push({
        name: "invalid-key",
        caught: true,
        errorType: err.name,
        message: err.message,
      });
      console.log(`Caught ${err.name}: ${err.message}`);
    }
  }

  // ── 2. CryptoError: tampered ciphertext ───────────────────────────────
  console.log("\n--- Test 2: Tampered ciphertext ---");
  const payload = encryptVote("Yes", VALID_KEY);
  const tampered = { ...payload, ciphertext: "00".repeat(16) };
  try {
    decryptVote(tampered, VALID_KEY);
  } catch (err: unknown) {
    if (err instanceof CryptoError) {
      results.push({
        name: "tampered-ciphertext",
        caught: true,
        errorType: err.name,
        message: err.message,
      });
      console.log(`Caught ${err.name}: ${err.message}`);
    }
  }

  // ── 3. CryptoError: wrong decryption key ──────────────────────────────
  console.log("\n--- Test 3: Wrong decryption key ---");
  try {
    decryptVote(payload, WRONG_KEY);
  } catch (err: unknown) {
    if (err instanceof CryptoError) {
      results.push({
        name: "wrong-key",
        caught: true,
        errorType: err.name,
        message: err.message,
      });
      console.log(`Caught ${err.name}: ${err.message}`);
    }
  }

  // ── 4. AnonVoteError base class catches all SDK errors ────────────────
  console.log("\n--- Test 4: Base class catches all SDK errors ---");
  try {
    encryptVote("test", "invalid");
  } catch (err: unknown) {
    if (err instanceof AnonVoteError) {
      results.push({
        name: "base-class-catch",
        caught: true,
        errorType: err.name,
        message: err.message,
      });
      console.log(`Caught via AnonVoteError base class: ${err.name}`);
    }
  }

  // ── 5. ValidationError from client: missing election title ────────────
  console.log("\n--- Test 5: Client validation error ---");
  const client = new AnonVoteClient({ encryptionKey: VALID_KEY });
  try {
    client.createElection({
      title: "",
      description: "Missing title",
      options: ["A", "B"],
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      results.push({
        name: "client-validation",
        caught: true,
        errorType: err.name,
        message: err.message,
      });
      console.log(`Caught ${err.name}: ${err.message}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n--- Summary: ${results.length} errors caught gracefully ---`);
  return results;
}

if (require.main === module) {
  main();
}
