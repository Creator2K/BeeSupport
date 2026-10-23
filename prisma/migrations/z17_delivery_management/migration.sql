ALTER TABLE "NotificationJob"
  ADD COLUMN "totalAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "manualRetries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outcome" TEXT;
UPDATE "NotificationJob" SET "totalAttempts" = "attempts";
CREATE INDEX "NotificationJob_createdAt_id_idx" ON "NotificationJob"("createdAt", "id");
CREATE INDEX "NotificationJob_kind_status_createdAt_idx" ON "NotificationJob"("kind", "status", "createdAt");
