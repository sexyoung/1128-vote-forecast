-- 全站候選人顯示開關。沒有列時程式以 false／版本 1 處理，第一次從後台儲存才建立。
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL,
    "hidePlaceholderCandidates" BOOLEAN NOT NULL DEFAULT false,
    "candidateVisibilityVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);
