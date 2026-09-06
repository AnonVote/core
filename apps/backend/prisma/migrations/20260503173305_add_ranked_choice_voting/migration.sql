-- AlterTable
ALTER TABLE "Ballot" ADD COLUMN     "allowRankedChoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxRankings" INTEGER;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN     "rank" INTEGER;
