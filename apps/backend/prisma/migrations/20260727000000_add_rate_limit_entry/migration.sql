-- Migration: add_rate_limit_entry
-- Adds a persisted rate-limit counter table for vote submission limits.
-- key format: "ip:<ip>", "ballot:<ballotId>", "token:<sha256hash>"

CREATE TABLE "RateLimitEntry" (
    "id"          TEXT         NOT NULL,
    "key"         TEXT         NOT NULL,
    "count"       INTEGER      NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitEntry_key_key" ON "RateLimitEntry"("key");
CREATE INDEX "RateLimitEntry_expiresAt_idx" ON "RateLimitEntry"("expiresAt");

-- Extend the AuditEventType enum with the new RATE_LIMIT_EXCEEDED value
ALTER TYPE "AuditEventType" ADD VALUE 'RATE_LIMIT_EXCEEDED';
