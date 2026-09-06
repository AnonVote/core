import { randomBytes } from "crypto";

/**
 * 64-char hex string (32 bytes) — matches the BALLOT_ENCRYPTION_KEY format
 * that encryptVote/decryptVote expect.
 */
export const KEY = randomBytes(32).toString("hex");

/** A representative vote option, matching what encryptVote actually takes. */
export const SAMPLE_OPTION = "Yes";

export function sampleIdentifier(i: number): string {
  return `voter-${i}@example.org`;
}
