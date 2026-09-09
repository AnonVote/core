-- AlterEnum
BEGIN;
CREATE TYPE "AnchorStatus_new" AS ENUM ('PENDING', 'ANCHORED', 'FAILED');
ALTER TABLE "Ballot" ALTER COLUMN "anchorStatus" DROP DEFAULT;
ALTER TABLE "Ballot" ALTER COLUMN "anchorStatus" TYPE "AnchorStatus_new" USING ("anchorStatus"::text::"AnchorStatus_new");

ALTER TYPE "AnchorStatus" RENAME TO "AnchorStatus_old";
ALTER TYPE "AnchorStatus_new" RENAME TO "AnchorStatus";
DROP TYPE "AnchorStatus_old";
ALTER TABLE "Ballot" ALTER COLUMN "anchorStatus" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "BallotStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'FINALISED');
ALTER TABLE "Ballot" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ballot" ALTER COLUMN "status" TYPE "BallotStatus_new" USING ("status"::text::"BallotStatus_new");
ALTER TYPE "BallotStatus" RENAME TO "BallotStatus_old";
ALTER TYPE "BallotStatus_new" RENAME TO "BallotStatus";
DROP TYPE "BallotStatus_old";
ALTER TABLE "Ballot" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "Option" DROP CONSTRAINT "Option_ballotId_fkey";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_optionId_fkey";

-- DropForeignKey
ALTER TABLE "ballot_anchor_retry_queue" DROP CONSTRAINT "ballot_anchor_retry_queue_ballotId_fkey";

-- DropForeignKey
ALTER TABLE "ballot_keys" DROP CONSTRAINT "ballot_keys_ballotId_fkey";

-- DropForeignKey
ALTER TABLE "stellar_retry_queue" DROP CONSTRAINT "stellar_retry_queue_vote_id_fkey";

-- AlterTable
ALTER TABLE "Vote" DROP COLUMN "encryptedPayload",
DROP COLUMN "optionId",
DROP COLUMN "stellarTxId",
ADD COLUMN     "anchor_status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "encrypted_option" TEXT NOT NULL,
ADD COLUMN     "stellar_tx_id" TEXT;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot_keys" ADD CONSTRAINT "ballot_keys_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stellar_retry_queue" ADD CONSTRAINT "stellar_retry_queue_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot_anchor_retry_queue" ADD CONSTRAINT "ballot_anchor_retry_queue_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

