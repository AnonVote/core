-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'BALLOT_METADATA_CHANGED';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "metadataCiphertext" TEXT;

-- AlterTable
ALTER TABLE "Ballot" ADD COLUMN     "commitmentAnchoredAt" TIMESTAMP(3),
ADD COLUMN     "commitmentHash" TEXT,
ADD COLUMN     "commitmentTxId" TEXT,
ADD COLUMN     "descriptionCiphertext" TEXT,
ADD COLUMN     "descriptionKeyVersion" INTEGER;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "keyDerivationSalt" TEXT,
ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "publicKey" TEXT;
