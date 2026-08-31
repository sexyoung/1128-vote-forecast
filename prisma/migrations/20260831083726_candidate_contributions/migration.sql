-- CreateEnum
CREATE TYPE "CandidateContributionKind" AS ENUM ('NEW_CANDIDATE', 'PHOTO_UPDATE');

-- CreateEnum
CREATE TYPE "CandidateContributionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CandidateContribution" (
    "id" TEXT NOT NULL,
    "kind" "CandidateContributionKind" NOT NULL,
    "status" "CandidateContributionStatus" NOT NULL DEFAULT 'PENDING',
    "contestId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateName" VARCHAR(40),
    "partyId" VARCHAR(16),
    "photoUrl" VARCHAR(2000) NOT NULL,
    "forecasterId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" VARCHAR(100),
    "reviewNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateContribution_status_createdAt_idx" ON "CandidateContribution"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateContribution_contestId_status_idx" ON "CandidateContribution"("contestId", "status");

-- CreateIndex
CREATE INDEX "CandidateContribution_candidateId_idx" ON "CandidateContribution"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateContribution_forecasterId_createdAt_idx" ON "CandidateContribution"("forecasterId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateContribution" ADD CONSTRAINT "CandidateContribution_forecasterId_fkey" FOREIGN KEY ("forecasterId") REFERENCES "Forecaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
