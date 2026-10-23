-- Keep every historical message; only clear duplicate retry keys before adding the constraint.
BEGIN;
LOCK TABLE "Message" IN SHARE ROW EXCLUSIVE MODE;
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "conversationId", "clientId" ORDER BY "createdAt", id
  ) AS duplicate_position
  FROM "Message" WHERE "clientId" IS NOT NULL
)
UPDATE "Message" SET "clientId" = NULL
WHERE id IN (SELECT id FROM duplicates WHERE duplicate_position > 1);

DROP INDEX IF EXISTS "Message_clientId_idx";
CREATE UNIQUE INDEX "Message_conversationId_clientId_key" ON "Message"("conversationId", "clientId");
COMMIT;
