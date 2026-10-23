ALTER TABLE "User" ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "AccountToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenVersion" INTEGER,
  "inviterId" TEXT,
  "role" "Role" NOT NULL DEFAULT 'AGENT',
  "siteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountToken_purpose_check" CHECK ("purpose" IN ('RESET', 'VERIFY', 'INVITE')),
  CONSTRAINT "AccountToken_role_check" CHECK ("role" <> 'ADMIN'),
  CONSTRAINT "AccountToken_owner_check" CHECK (("purpose" = 'INVITE' AND "userId" IS NULL AND "inviterId" IS NOT NULL) OR ("purpose" <> 'INVITE' AND "userId" IS NOT NULL AND "tokenVersion" IS NOT NULL))
);
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_tenantId_purpose_createdAt_idx" ON "AccountToken"("tenantId", "purpose", "createdAt");
CREATE INDEX "AccountToken_userId_purpose_idx" ON "AccountToken"("userId", "purpose");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");
