-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "stellarLedgerAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "stellarLedgerAt" TIMESTAMP(3);
