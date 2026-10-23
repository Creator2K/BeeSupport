ALTER TABLE "CannedResponse" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
CREATE INDEX "CannedResponse_tenantId_category_idx" ON "CannedResponse"("tenantId", "category");
