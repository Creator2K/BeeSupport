CREATE TABLE "FollowUpRule" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "ownerId" TEXT,
  "delayMinutes" INTEGER NOT NULL DEFAULT 60,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FollowUpRule_delay_check" CHECK ("delayMinutes" BETWEEN 1 AND 10080),
  CONSTRAINT "FollowUpRule_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "FollowUpRule_siteId_key" ON "FollowUpRule"("siteId");
CREATE INDEX "FollowUpRule_ownerId_idx" ON "FollowUpRule"("ownerId");
ALTER TABLE "FollowUpRule" ADD CONSTRAINT "FollowUpRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpRule" ADD CONSTRAINT "FollowUpRule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
