ALTER TABLE "Site" ADD COLUMN "embedSeenAt" TIMESTAMP(3), ADD COLUMN "embedOrigin" TEXT;
CREATE TABLE "AccountNotice" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "expirySnapshot" TIMESTAMP(3), "readAt" TIMESTAMP(3), "mailJobId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AccountNotice_userId_dedupeKey_key" UNIQUE ("userId", "dedupeKey")
);
CREATE INDEX "AccountNotice_tenantId_userId_createdAt_idx" ON "AccountNotice"("tenantId", "userId", "createdAt");
CREATE INDEX "Tenant_status_expiresAt_idx" ON "Tenant"("status", "expiresAt");
