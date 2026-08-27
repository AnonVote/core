/**
 * Ballot commitment (Issue #86).
 *
 * A SHA-256 commitment over a ballot's user-visible content, anchored on-chain at
 * activation so a voter can detect a ballot being altered after they were invited.
 *
 * The description is committed as a hash of its PLAINTEXT, not its ciphertext: a
 * voter can still verify the ballot has not changed without reading an admin-only
 * field, but the committed value survives re-encryption. Committing the ciphertext
 * would be unsound — encrypting identical content twice yields different envelopes
 * (fresh ephemeral key per call), so a password-change re-encryption would
 * permanently invalidate an already-anchored, write-once commitment.
 *
 * `frontend/src/utils/commitment.ts` MUST produce byte-identical output — the
 * shared fixture in the test suites is what keeps the two in lockstep. Any change
 * here is a breaking change to every previously anchored commitment.
 */
import { createHash } from "crypto";

export interface BallotCommitmentInput {
  topic: string;
  /** sha256 hex of the description plaintext; null when there is no description. */
  descriptionHash?: string | null;
  options: { text: string }[];
  deadline: Date | string;
}

/**
 * Canonical JSON for a ballot.
 *
 * Options are sorted lexicographically because `Option` has no ordering column
 * and Prisma does not guarantee row order — without the sort the same ballot
 * hashes differently across reads. Duplicate option texts are already rejected at
 * validation, so the sort is stable.
 */
export function canonicalBallotPayload(input: BallotCommitmentInput): string {
  const deadline =
    input.deadline instanceof Date ? input.deadline : new Date(input.deadline);

  if (isNaN(deadline.getTime())) {
    throw new Error("commitment: deadline must be a valid date");
  }

  return JSON.stringify({
    topic: input.topic.trim(),
    // Legacy ballots (and ballots with no description) canonicalize to "" so a
    // commitment remains computable for them.
    descriptionHash: input.descriptionHash ?? "",
    options: input.options.map((o) => o.text.trim()).sort(),
    deadline: deadline.toISOString(),
  });
}

export function computeBallotCommitment(input: BallotCommitmentInput): string {
  return createHash("sha256")
    .update(canonicalBallotPayload(input), "utf8")
    .digest("hex");
}
