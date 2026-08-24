CREATE TABLE "reissue_rate_limits" (
    "id" TEXT NOT NULL,
    "identifier_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reissue_rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reissue_rate_limits_identifier_hash_key" ON "reissue_rate_limits"("identifier_hash");

CREATE TABLE "ballot_keys" (
    "id" TEXT NOT NULL,
    "ballotId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousKey" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ballot_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ballot_keys_ballotId_key" ON "ballot_keys"("ballotId");

ALTER TABLE "ballot_keys" ADD CONSTRAINT "ballot_keys_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE;

CREATE TABLE "stellar_retry_queue" (
    "id" TEXT NOT NULL,
    "vote_id" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stellar_retry_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stellar_retry_queue_vote_id_key" ON "stellar_retry_queue"("vote_id");

ALTER TABLE "stellar_retry_queue" ADD CONSTRAINT "stellar_retry_queue_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "Vote"("id") ON DELETE CASCADE;
