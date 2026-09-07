/**
 * token-workflow.ts
 *
 * Demonstrates the voter token lifecycle:
 *   1. Generating a random one-time token
 *   2. Hashing the token for server-side storage
 *   3. Distributing the raw token to the voter
 *   4. Verifying a token hash matches the original
 *   5. Handling invalid token input
 *
 * Run with: npx tsx examples/token-workflow.ts
 */

import { generateToken, hashToken } from "../src/crypto";

export interface TokenRecord {
  tokenHash: string;
  ballotId: string;
  used: boolean;
  issuedAt: string;
}

const SAMPLE_BALLOT_ID = "elec-00000000-0000-4000-8000-000000000001";

export function main(): TokenRecord {
  // ── 1. Generate a one-time voter token ────────────────────────────────
  const rawToken = generateToken();
  console.log(`Generated token: ${rawToken.slice(0, 16)}... (${rawToken.length} chars)`);

  // ── 2. Hash the token for server-side storage ─────────────────────────
  // Only the hash is stored — the raw token is given to the voter and discarded
  const tokenHash = hashToken(rawToken);
  console.log(`Token hash: ${tokenHash.slice(0, 16)}... (${tokenHash.length} chars)`);

  // ── 3. Create a token record (as stored in the database) ──────────────
  const record: TokenRecord = {
    tokenHash,
    ballotId: SAMPLE_BALLOT_ID,
    used: false,
    issuedAt: new Date().toISOString(),
  };
  console.log(`Token record created for ballot: ${record.ballotId}`);

  // ── 4. Verify the hash matches the original token ─────────────────────
  const verificationHash = hashToken(rawToken);
  const matches = verificationHash === tokenHash;
  console.log(`\nHash verification: ${matches ? "PASSED" : "FAILED"}`);

  // ── 5. Show that different tokens produce different hashes ────────────
  const token2 = generateToken();
  const hash2 = hashToken(token2);
  const different = tokenHash !== hash2;
  console.log(`Different tokens produce different hashes: ${different ? "YES" : "NO"}`);

  // ── 6. Demonstrate that hashToken preserves exact input ───────────────
  // Unlike hashIdentifier, hashToken does NOT normalize input
  const upperHash = hashToken("MYTOKEN");
  const lowerHash = hashToken("mytoken");
  const caseSensitive = upperHash !== lowerHash;
  console.log(`hashToken is case-sensitive (unlike hashIdentifier): ${caseSensitive ? "YES" : "NO"}`);

  console.log(`\nToken workflow complete. Raw token would be distributed to voter.`);
  console.log(`Only the hash is stored server-side.`);

  return record;
}

if (require.main === module) {
  main();
}
