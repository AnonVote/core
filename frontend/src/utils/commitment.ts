/**
 * Ballot commitment — browser mirror of `backend/src/utils/commitment.ts`.
 *
 * These two implementations MUST produce byte-identical output. A shared fixture
 * is asserted in both test suites to keep them in lockstep; changing one without
 * the other silently breaks verification for every ballot.
 */
import { sha256 } from "@noble/hashes/sha2.js";

export interface BallotCommitmentInput {
  topic: string;
  descriptionCiphertext?: string | null;
  options: { text: string }[];
  deadline: Date | string;
}

/**
 * Options are sorted lexicographically because the backend's `Option` table has
 * no ordering column — without the sort the same ballot hashes differently
 * across reads.
 */
export function canonicalBallotPayload(input: BallotCommitmentInput): string {
  const deadline =
    input.deadline instanceof Date ? input.deadline : new Date(input.deadline);

  if (isNaN(deadline.getTime())) {
    throw new Error("commitment: deadline must be a valid date");
  }

  return JSON.stringify({
    topic: input.topic.trim(),
    descriptionCiphertext: input.descriptionCiphertext ?? "",
    options: input.options.map((o) => o.text.trim()).sort(),
    deadline: deadline.toISOString(),
  });
}

export function computeBallotCommitment(input: BallotCommitmentInput): string {
  const bytes = sha256(new TextEncoder().encode(canonicalBallotPayload(input)));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
