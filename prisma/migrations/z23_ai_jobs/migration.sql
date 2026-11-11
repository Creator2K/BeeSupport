CREATE TABLE "AiJob" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "conversationId" TEXT,
  "knowledgeId" TEXT,
  "messageId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "result" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiJob_resource_check" CHECK (
    ("kind" = 'AUTO_REPLY' AND "conversationId" IS NOT NULL AND "messageId" IS NOT NULL AND "knowledgeId" IS NULL) OR
    ("kind" = 'KNOWLEDGE_INDEX' AND "knowledgeId" IS NOT NULL AND "conversationId" IS NULL AND "messageId" IS NULL)
  ),
  CONSTRAINT "AiJob_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED')),
  CONSTRAINT "AiJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiJob_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "AiKnowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiJob_conversationId_key" ON "AiJob"("conversationId");
CREATE UNIQUE INDEX "AiJob_knowledgeId_key" ON "AiJob"("knowledgeId");
CREATE INDEX "AiJob_status_availableAt_idx" ON "AiJob"("status", "availableAt");
CREATE INDEX "AiJob_status_lockedUntil_idx" ON "AiJob"("status", "lockedUntil");

CREATE TABLE "AiToolEffect" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "arguments" JSONB NOT NULL,
  "output" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiToolEffect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiToolEffect_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiToolEffect_messageId_key_key" ON "AiToolEffect"("messageId", "key");
-- No backfill: historical conversations must not receive unsolicited AI replies.
