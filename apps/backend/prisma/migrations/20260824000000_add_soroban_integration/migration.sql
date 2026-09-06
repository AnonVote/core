-- Issue #77: Soroban integration layer — idempotency key + dead letter queue.

-- Deterministic per-vote idempotency key used by record_vote / batch_record_votes.
ALTER TABLE "Vote" ADD COLUMN "vote_id_hash" TEXT;
CREATE UNIQUE INDEX "Vote_vote_id_hash_key" ON "Vote"("vote_id_hash");

-- Dead letter queue: votes whose on-chain anchoring exhausted all retries.
CREATE TABLE "soroban_dead_letters" (
    "id" TEXT NOT NULL,
    "vote_id" TEXT NOT NULL,
    "ballot_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "last_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soroban_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soroban_dead_letters_vote_id_key" ON "soroban_dead_letters"("vote_id");
CREATE INDEX "soroban_dead_letters_resolved_at_idx" ON "soroban_dead_letters"("resolved_at");

ALTER TABLE "soroban_dead_letters" ADD CONSTRAINT "soroban_dead_letters_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;