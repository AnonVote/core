-- AlterEnum: Add ACTIVE and FINALISED to BallotStatus, rename OPEN to ACTIVE
-- Prisma doesn't support enum value renaming directly, so we:
-- 1. Add new enum values ACTIVE and FINALISED
-- 2. Migrate existing OPEN data to ACTIVE
-- 3. Remove OPEN value

-- First, add the new enum values
ALTER TYPE "BallotStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "BallotStatus" ADD VALUE IF NOT EXISTS 'FINALISED';

-- Migrate existing OPEN ballots to ACTIVE
ALTER TABLE "Ballot" ALTER COLUMN "status" TYPE TEXT;
UPDATE "Ballot" SET status = 'ACTIVE' WHERE status = 'OPEN';
ALTER TABLE "Ballot" ALTER COLUMN "status" TYPE "BallotStatus" USING status::text::"BallotStatus";

-- Add new columns to Ballot table
ALTER TABLE "Ballot" ADD COLUMN "startTime" TIMESTAMP(3);
ALTER TABLE "Ballot" ADD COLUMN "autoFinalise" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ballot" ADD COLUMN "optionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ballot" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Update default status to DRAFT
ALTER TABLE "Ballot" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Create ballot anchor retry queue table
CREATE TABLE "ballot_anchor_retry_queue" (
    "id" TEXT NOT NULL,
    "ballotId" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ballot_anchor_retry_queue_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on ballotId
CREATE UNIQUE INDEX "ballot_anchor_retry_queue_ballotId_key" ON "ballot_anchor_retry_queue"("ballotId");

-- Add foreign key constraint
ALTER TABLE "ballot_anchor_retry_queue" 
  ADD CONSTRAINT "ballot_anchor_retry_queue_ballotId_fkey" 
  FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE;