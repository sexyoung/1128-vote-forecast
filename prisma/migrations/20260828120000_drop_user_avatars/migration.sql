-- 平台不再讓使用者上傳圖片。頭像欄位、它的下架旗標，以及只有頭像用得到的檢舉
-- 類別一起移除。

-- ⚠️ DESTRUCTIVE：頭像檢舉在沒有頭像之後沒有東西可以處理，而且留著會讓下面的
-- 列舉型別重建失敗（USING 轉不出 'AVATAR'）。
DELETE FROM "Report" WHERE "targetType" = 'AVATAR';

-- AlterEnum：PostgreSQL 不能單獨拿掉列舉的一個值，只能整個型別重建。
BEGIN;
CREATE TYPE "ReportTargetType_new" AS ENUM ('COMMENT');
ALTER TABLE "Report" ALTER COLUMN "targetType" TYPE "ReportTargetType_new" USING ("targetType"::text::"ReportTargetType_new");
ALTER TYPE "ReportTargetType" RENAME TO "ReportTargetType_old";
ALTER TYPE "ReportTargetType_new" RENAME TO "ReportTargetType";
DROP TYPE "ReportTargetType_old";
COMMIT;

-- ⚠️ DESTRUCTIVE：物件儲存的 key 與下架時間一起消失，救不回來。bucket 本身要
-- 另外手動清空（開發是 compose 的 MinIO，正式環境沒有部署過就沒有東西要清）。
ALTER TABLE "Forecaster" DROP COLUMN "avatarKey";
ALTER TABLE "Forecaster" DROP COLUMN "avatarBlockedAt";
