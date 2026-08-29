-- 後台不再匯入候選人、遷移舊預測或覆寫席次。保留 Candidate 資料本身，
-- 只移除已無讀寫路徑的批次來源、操作紀錄與席次覆寫。

ALTER TABLE "Candidate" DROP CONSTRAINT "Candidate_batchId_fkey";
ALTER TABLE "Candidate" DROP COLUMN "batchId";

DROP TABLE "PredictionMigration";
DROP TABLE "CandidateImport";
DROP TABLE "ContestSeatOverride";

DROP TYPE "ImportMode";
DROP TYPE "SeatsSource";
