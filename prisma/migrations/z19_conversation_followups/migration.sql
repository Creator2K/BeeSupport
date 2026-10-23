CREATE TABLE "FollowUp" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "ownerId" TEXT,
  "note" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FollowUp_status_check" CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED')),
  CONSTRAINT "FollowUp_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "FollowUp_conversationId_key" ON "FollowUp"("conversationId");
CREATE INDEX "FollowUp_tenantId_status_dueAt_idx" ON "FollowUp"("tenantId", "status", "dueAt");
CREATE INDEX "FollowUp_ownerId_status_dueAt_idx" ON "FollowUp"("ownerId", "status", "dueAt");
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
