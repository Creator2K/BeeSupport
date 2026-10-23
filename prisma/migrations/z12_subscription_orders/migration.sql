CREATE TABLE "SubscriptionPlan" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "priceCents" INTEGER NOT NULL CHECK ("priceCents" >= 0), "durationDays" INTEGER NOT NULL CHECK ("durationDays" > 0),
 "maxAgents" INTEGER NOT NULL CHECK ("maxAgents" > 0), "maxSites" INTEGER NOT NULL CHECK ("maxSites" > 0),
 "monthlyConversations" INTEGER NOT NULL CHECK ("monthlyConversations" > 0), "storageMB" INTEGER NOT NULL CHECK ("storageMB" > 0),
 "active" BOOLEAN NOT NULL DEFAULT false, "sortOrder" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SubscriptionPlan_active_sortOrder_idx" ON "SubscriptionPlan"("active", "sortOrder");
CREATE TABLE "SubscriptionOrder" (
 "id" TEXT PRIMARY KEY, "orderNo" TEXT NOT NULL UNIQUE,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "planId" TEXT NOT NULL REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "clientRequestId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','EXPIRED')),
 "planName" TEXT NOT NULL, "priceCents" INTEGER NOT NULL CHECK ("priceCents" >= 0),
 "durationDays" INTEGER NOT NULL CHECK ("durationDays" > 0), "maxAgents" INTEGER NOT NULL CHECK ("maxAgents" > 0),
 "maxSites" INTEGER NOT NULL CHECK ("maxSites" > 0), "monthlyConversations" INTEGER NOT NULL CHECK ("monthlyConversations" > 0),
 "storageMB" INTEGER NOT NULL CHECK ("storageMB" > 0),
 "requestedById" TEXT, "requestedByName" TEXT NOT NULL, "merchantNote" TEXT NOT NULL DEFAULT '',
 "reviewedById" TEXT, "reviewedByName" TEXT, "reviewNote" TEXT NOT NULL DEFAULT '', "paymentReference" TEXT NOT NULL DEFAULT '',
 "validUntil" TIMESTAMP(3) NOT NULL, "reviewedAt" TIMESTAMP(3), "periodStart" TIMESTAMP(3), "periodEnd" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SubscriptionOrder_tenantId_clientRequestId_key" UNIQUE ("tenantId", "clientRequestId")
);
CREATE INDEX "SubscriptionOrder_tenantId_createdAt_idx" ON "SubscriptionOrder"("tenantId", "createdAt");
CREATE INDEX "SubscriptionOrder_status_createdAt_idx" ON "SubscriptionOrder"("status", "createdAt");
CREATE UNIQUE INDEX "SubscriptionOrder_one_pending_per_tenant" ON "SubscriptionOrder"("tenantId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "SubscriptionOrder_unique_payment_reference" ON "SubscriptionOrder"("paymentReference") WHERE "status" = 'CONFIRMED' AND "priceCents" > 0 AND "paymentReference" <> '';
