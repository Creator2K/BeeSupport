-- AlterEnum
ALTER TYPE "MessageSender" ADD VALUE 'AI';

-- AlterEnum
ALTER TYPE "WebhookType" ADD VALUE 'WECHAT';

-- CreateTable
CREATE TABLE "AiKnowledge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiKnowledge_siteId_enabled_idx" ON "AiKnowledge"("siteId", "enabled");

-- AddForeignKey
ALTER TABLE "AiKnowledge" ADD CONSTRAINT "AiKnowledge_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

