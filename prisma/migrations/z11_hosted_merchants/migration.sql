ALTER TYPE "Role" ADD VALUE 'MERCHANT_ADMIN';
CREATE TABLE "Tenant" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE', "planName" TEXT NOT NULL DEFAULT '基础版',
 "expiresAt" TIMESTAMP(3), "maxAgents" INTEGER NOT NULL DEFAULT 5,
 "maxSites" INTEGER NOT NULL DEFAULT 3, "monthlyConversations" INTEGER NOT NULL DEFAULT 3000,
 "storageMB" INTEGER NOT NULL DEFAULT 1024, "defaults" JSONB NOT NULL DEFAULT '{}',
 "contactEmail" TEXT, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "Tenant" ("id", "name", "slug", "planName", "maxAgents", "maxSites", "monthlyConversations", "storageMB")
 VALUES ('legacy', '默认商家', 'default', '原有数据保留套餐', 100000, 100000, 100000000, 100000000);
ALTER TABLE "User" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
ALTER TABLE "Site" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Site_tenantId_idx" ON "Site"("tenantId");
ALTER TABLE "CannedResponse" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "CannedResponse" ADD CONSTRAINT "CannedResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CannedResponse_tenantId_idx" ON "CannedResponse"("tenantId");
ALTER TABLE "AiKnowledge" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AiKnowledge" ADD CONSTRAINT "AiKnowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AiKnowledge_tenantId_idx" ON "AiKnowledge"("tenantId");
ALTER TABLE "WebhookEndpoint" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");
ALTER TABLE "RiskRule" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "RiskRule" ADD CONSTRAINT "RiskRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RiskRule_tenantId_idx" ON "RiskRule"("tenantId");
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");
ALTER TABLE "Site" ADD COLUMN "widgetSettings" JSONB NOT NULL DEFAULT '{}';
