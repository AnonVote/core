-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'TOKEN_DELIVERY_FAILED';

-- AlterEnum
ALTER TYPE "BallotStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "Ballot" ADD COLUMN     "anchorStatus" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "stellarTxId" TEXT;

-- CreateTable
CREATE TABLE "TokenDeliveryRetry" (
    "id" TEXT NOT NULL,
    "ballotId" TEXT NOT NULL,
    "voterTokenId" TEXT NOT NULL,
    "recipientEncrypted" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenDeliveryRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenDeliveryRetry_voterTokenId_key" ON "TokenDeliveryRetry"("voterTokenId");

-- AddForeignKey
ALTER TABLE "TokenDeliveryRetry" ADD CONSTRAINT "TokenDeliveryRetry_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDeliveryRetry" ADD CONSTRAINT "TokenDeliveryRetry_voterTokenId_fkey" FOREIGN KEY ("voterTokenId") REFERENCES "VoterToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
