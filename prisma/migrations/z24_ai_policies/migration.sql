-- Merchant and site policy overrides plus monthly usage accounting.
CREATE TABLE "AiPolicy" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoReply" TEXT NOT NULL DEFAULT 'inherit',
    "assistantName" TEXT,
    "systemPrompt" TEXT,
    "allowTools" BOOLEAN,
    "allowMutations" BOOLEAN NOT NULL DEFAULT true,
    "monthlyRequestLimit" INTEGER,
    "monthlyTokenLimit" INTEGER,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 2,
    "overLimitAction" TEXT NOT NULL DEFAULT 'skip',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiPolicy_pkey" PRIMARY KEY ("tenantId")
);

CREATE TABLE "AiSitePolicy" (
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "autoReply" TEXT,
    "assistantName" TEXT,
    "systemPrompt" TEXT,
    "allowTools" BOOLEAN,
    "allowMutations" BOOLEAN,
    "monthlyRequestLimit" INTEGER,
    "monthlyTokenLimit" INTEGER,
    "concurrencyLimit" INTEGER,
    "overLimitAction" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiSitePolicy_pkey" PRIMARY KEY ("siteId")
);

CREATE TABLE "AiUsageDaily" (
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiUsageDaily_pkey" PRIMARY KEY ("tenantId","siteId","day")
);

CREATE INDEX "AiSitePolicy_tenantId_idx" ON "AiSitePolicy"("tenantId");
CREATE INDEX "AiUsageDaily_tenantId_day_idx" ON "AiUsageDaily"("tenantId","day");

ALTER TABLE "AiPolicy" ADD CONSTRAINT "AiPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSitePolicy" ADD CONSTRAINT "AiSitePolicy_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSitePolicy" ADD CONSTRAINT "AiSitePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageDaily" ADD CONSTRAINT "AiUsageDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageDaily" ADD CONSTRAINT "AiUsageDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing tasks inherit their tenant from the linked conversation or knowledge entry.
ALTER TABLE "AiJob" ADD COLUMN "tenantId" TEXT;
UPDATE "AiJob" AS job
SET "tenantId" = COALESCE(
    (
        SELECT site."tenantId"
        FROM "Conversation" conversation
        JOIN "Site" site ON site."id" = conversation."siteId"
        WHERE conversation."id" = job."conversationId"
    ),
    (
        SELECT knowledge."tenantId"
        FROM "AiKnowledge" knowledge
        WHERE knowledge."id" = job."knowledgeId"
    )
)
WHERE job."tenantId" IS NULL;
DELETE FROM "AiJob" WHERE "tenantId" IS NULL;
ALTER TABLE "AiJob" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "AiJob_tenantId_status_lockedUntil_idx" ON "AiJob"("tenantId", "status", "lockedUntil");
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
