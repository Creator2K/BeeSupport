ALTER TABLE "Visitor" ADD COLUMN "profileTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "profileNote" TEXT;
CREATE TABLE "RiskRule" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "value" TEXT NOT NULL, "note" TEXT,
  "siteId" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiskRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RiskRule_kind_active_siteId_idx" ON "RiskRule"("kind", "active", "siteId");
CREATE TABLE "RiskEvent" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "ruleId" TEXT, "ruleValue" TEXT NOT NULL,
  "siteId" TEXT, "visitorId" TEXT, "ip" TEXT NOT NULL, "context" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RiskEvent_siteId_createdAt_idx" ON "RiskEvent"("siteId", "createdAt");
CREATE INDEX "RiskEvent_createdAt_idx" ON "RiskEvent"("createdAt");
