ALTER TABLE "Conversation" ADD COLUMN "aiReplyToken" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "aiReplyExpiresAt" TIMESTAMP(3);
