ALTER TABLE "SubscriptionOrder"
  ADD COLUMN "paymentReportedAt" TIMESTAMP(3),
  ADD COLUMN "paymentNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "paymentReportVersion" INTEGER NOT NULL DEFAULT 0;
