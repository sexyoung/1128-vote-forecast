-- 候選人與後台。時間戳訂在中選會預定公告名單的那天（2026-11-12），不是這支
-- migration 真正套用的日期——schema 要先就位，等公告一到就能直接匯入，不必臨時
-- 現改資料庫。

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('REGISTERED', 'CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('DRY_RUN', 'APPLY');

-- CreateEnum
CREATE TYPE "SeatsSource" AS ENUM ('OFFICIAL', 'PLACEHOLDER');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "partyId" TEXT,
    "name" VARCHAR(40) NOT NULL,
    "nameEn" VARCHAR(80),
    "ballotNo" INTEGER,
    "status" "CandidateStatus" NOT NULL DEFAULT 'REGISTERED',
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateImport" (
    "id" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL,
    "csvSha256" VARCHAR(64) NOT NULL,
    "fileName" VARCHAR(120),
    "rowCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionMigration" (
    "id" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL,
    "useOrdinalMatching" BOOLEAN NOT NULL DEFAULT false,
    "picksRemapped" INTEGER NOT NULL DEFAULT 0,
    "picksAmbiguous" INTEGER NOT NULL DEFAULT 0,
    "predictionsInvalidated" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionMigration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestSeatOverride" (
    "contestId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "seatsSource" "SeatsSource" NOT NULL,
    "note" VARCHAR(200),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestSeatOverride_pkey" PRIMARY KEY ("contestId")
);

-- CreateIndex
CREATE INDEX "Candidate_contestId_partyId_idx" ON "Candidate"("contestId", "partyId");

-- CreateIndex
CREATE INDEX "Candidate_contestId_idx" ON "Candidate"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_contestId_ballotNo_key" ON "Candidate"("contestId", "ballotNo");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_contestId_name_key" ON "Candidate"("contestId", "name");

-- CreateIndex
CREATE INDEX "CandidateImport_createdAt_idx" ON "CandidateImport"("createdAt");

-- CreateIndex
CREATE INDEX "PredictionMigration_createdAt_idx" ON "PredictionMigration"("createdAt");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CandidateImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
