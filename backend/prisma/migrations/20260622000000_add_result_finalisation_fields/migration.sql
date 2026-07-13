-- AddColumn: sorobanTxId, finalised, finalisedAt to Result table
ALTER TABLE "Result" ADD COLUMN "sorobanTxId" TEXT;
ALTER TABLE "Result" ADD COLUMN "finalised" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Result" ADD COLUMN "finalisedAt" TIMESTAMP(3);
