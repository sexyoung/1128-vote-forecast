-- 全站公告。永遠只有一列，用固定的 id upsert（見 src/server/announcement.ts）。

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "linkUrl" VARCHAR(300),
    "linkLabel" VARCHAR(40),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
