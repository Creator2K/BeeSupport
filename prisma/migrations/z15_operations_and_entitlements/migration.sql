ALTER TABLE "Tenant" ADD COLUMN "managementVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SubscriptionPlan" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SubscriptionOrder" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "SubscriptionOrder_status_reviewedAt_idx" ON "SubscriptionOrder"("status", "reviewedAt");
