ALTER TABLE "Conversation" ADD COLUMN "waitingSince" TIMESTAMP(3), ADD COLUMN "waitingMessageId" TEXT;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_waiting_pair_check" CHECK (("waitingSince" IS NULL) = ("waitingMessageId" IS NULL));
CREATE INDEX "Conversation_waitingSince_id_idx" ON "Conversation"("waitingSince", "id");
CREATE TABLE "UnansweredRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "siteId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "ownerId" TEXT,
  "recipientMode" TEXT NOT NULL DEFAULT 'ASSIGNED_OR_OWNER',
  "delayMinutes" INTEGER NOT NULL DEFAULT 10,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnansweredRule_delay_check" CHECK ("delayMinutes" BETWEEN 1 AND 10080),
  CONSTRAINT "UnansweredRule_version_check" CHECK ("version" > 0),
  CONSTRAINT "UnansweredRule_mode_check" CHECK ("recipientMode" IN ('OWNER', 'ASSIGNED_OR_OWNER'))
);
CREATE UNIQUE INDEX "UnansweredRule_siteId_key" ON "UnansweredRule"("siteId");
CREATE INDEX "UnansweredRule_ownerId_idx" ON "UnansweredRule"("ownerId");
ALTER TABLE "UnansweredRule" ADD FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnansweredRule" ADD FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "UnansweredReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "recipientId" TEXT,
  "ruleId" TEXT,
  "ruleVersion" INTEGER NOT NULL,
  "waitingMessageId" TEXT NOT NULL,
  "waitingSince" TIMESTAMP(3) NOT NULL,
  "remindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  CONSTRAINT "UnansweredReminder_resolution_check" CHECK (("resolvedAt" IS NULL AND "resolution" IS NULL) OR ("resolvedAt" IS NOT NULL AND "resolution" IS NOT NULL AND "resolution" IN ('REPLIED', 'CLOSED', 'DISABLED')))
);
CREATE UNIQUE INDEX "UnansweredReminder_conversationId_waitingMessageId_key" ON "UnansweredReminder"("conversationId", "waitingMessageId");
CREATE INDEX "UnansweredReminder_tenantId_resolvedAt_remindedAt_idx" ON "UnansweredReminder"("tenantId", "resolvedAt", "remindedAt");
CREATE INDEX "UnansweredReminder_recipientId_resolvedAt_remindedAt_idx" ON "UnansweredReminder"("recipientId", "resolvedAt", "remindedAt");
CREATE INDEX "UnansweredReminder_ruleId_idx" ON "UnansweredReminder"("ruleId");
ALTER TABLE "UnansweredReminder" ADD FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnansweredReminder" ADD FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnansweredReminder" ADD FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnansweredReminder" ADD FOREIGN KEY ("ruleId") REFERENCES "UnansweredRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
