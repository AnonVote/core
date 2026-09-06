-- AlterTable
ALTER TABLE "Ballot" ADD COLUMN     "allowWeightedVoting" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EligibilityEntry" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;
