-- AlterTable
ALTER TABLE "PredictionPick" ADD COLUMN     "partyId" TEXT;

-- CreateIndex
CREATE INDEX "PredictionPick_partyId_idx" ON "PredictionPick"("partyId");
