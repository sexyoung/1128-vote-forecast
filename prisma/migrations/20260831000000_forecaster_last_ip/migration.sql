-- 後台濫用調查使用：只保存每個身份最近一次完整 IP 與 edge 推測位置，不建歷史表。
ALTER TABLE "Forecaster"
ADD COLUMN "lastIp" VARCHAR(45),
ADD COLUMN "lastIpAt" TIMESTAMP(3),
ADD COLUMN "lastCountry" VARCHAR(2),
ADD COLUMN "lastRegion" VARCHAR(100),
ADD COLUMN "lastCity" VARCHAR(100),
ADD COLUMN "lastGeoSource" VARCHAR(16);
