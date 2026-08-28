-- CreateEnum
CREATE TYPE "SignalKind" AS ENUM ('COOKIE', 'FINGERPRINT', 'IP');

-- CreateEnum
CREATE TYPE "PredictionTargetType" AS ENUM ('PARTY', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('ACTIVE', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "PredictionInvalidReason" AS ENUM ('PARTY_HAS_NO_CANDIDATE', 'CANDIDATE_WITHDRAWN', 'CANDIDATE_DISQUALIFIED', 'DISTRICT_CHANGED', 'ADMIN_INVALIDATED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('COMMENT', 'AVATAR');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'ABUSE', 'ADULT', 'ILLEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Forecaster" (
    "id" TEXT NOT NULL,
    "displayName" VARCHAR(24),
    "avatarKey" TEXT,
    "avatarBlockedAt" TIMESTAMP(3),
    "humanVerifiedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Forecaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecasterSignal" (
    "id" TEXT NOT NULL,
    "forecasterId" TEXT NOT NULL,
    "kind" "SignalKind" NOT NULL,
    "hash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ForecasterSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "forecasterId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "status" "PredictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "invalidReason" "PredictionInvalidReason",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionPick" (
    "predictionId" TEXT NOT NULL,
    "targetType" "PredictionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "PredictionPick_pkey" PRIMARY KEY ("predictionId","targetType","targetId")
);

-- CreateTable
CREATE TABLE "PredictionRevision" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "picks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestTally" (
    "contestId" TEXT NOT NULL,
    "targetType" "PredictionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestTally_pkey" PRIMARY KEY ("contestId","targetType","targetId")
);

-- CreateTable
CREATE TABLE "ContestSummary" (
    "contestId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "totalPredictions" INTEGER NOT NULL DEFAULT 0,
    "leaderType" "PredictionTargetType",
    "leaderId" TEXT,
    "leaderPercent" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestSummary_pkey" PRIMARY KEY ("contestId")
);

-- CreateTable
CREATE TABLE "ContestTallySnapshot" (
    "contestId" TEXT NOT NULL,
    "capturedOn" DATE NOT NULL,
    "targetType" "PredictionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "ContestTallySnapshot_pkey" PRIMARY KEY ("contestId","capturedOn","targetType","targetId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "forecasterId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" VARCHAR(1000) NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Forecaster_lastSeenAt_idx" ON "Forecaster"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ForecasterSignal_kind_hash_idx" ON "ForecasterSignal"("kind", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "ForecasterSignal_forecasterId_kind_hash_key" ON "ForecasterSignal"("forecasterId", "kind", "hash");

-- CreateIndex
CREATE INDEX "Prediction_contestId_status_idx" ON "Prediction"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_forecasterId_contestId_key" ON "Prediction"("forecasterId", "contestId");

-- CreateIndex
CREATE INDEX "PredictionPick_targetType_targetId_idx" ON "PredictionPick"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionRevision_predictionId_version_key" ON "PredictionRevision"("predictionId", "version");

-- CreateIndex
CREATE INDEX "ContestTally_contestId_idx" ON "ContestTally"("contestId");

-- CreateIndex
CREATE INDEX "ContestSummary_jurisdictionId_idx" ON "ContestSummary"("jurisdictionId");

-- CreateIndex
CREATE INDEX "ContestTallySnapshot_capturedOn_idx" ON "ContestTallySnapshot"("capturedOn");

-- CreateIndex
CREATE INDEX "Comment_contestId_status_createdAt_idx" ON "Comment"("contestId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ForecasterSignal" ADD CONSTRAINT "ForecasterSignal_forecasterId_fkey" FOREIGN KEY ("forecasterId") REFERENCES "Forecaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_forecasterId_fkey" FOREIGN KEY ("forecasterId") REFERENCES "Forecaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionPick" ADD CONSTRAINT "PredictionPick_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionRevision" ADD CONSTRAINT "PredictionRevision_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_forecasterId_fkey" FOREIGN KEY ("forecasterId") REFERENCES "Forecaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Forecaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
