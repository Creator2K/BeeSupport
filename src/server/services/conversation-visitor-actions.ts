import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { VisitorSession } from "../../lib/visitor-auth";
import { broadcastConversation } from "./broadcast";

export async function rateConversation(
  visitor: VisitorSession,
  conversationId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  if (rating < 1 || rating > 5) throw new HttpError(400, "评分必须在 1-5 之间");

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, visitorId: true, siteId: true },
  });
  if (
    !conversation ||
    conversation.visitorId !== visitor.visitorId ||
    conversation.siteId !== visitor.siteId
  ) {
    throw new HttpError(404, "会话不存在");
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      rating,
      ratingComment: comment?.slice(0, 500) ?? null,
      ratedAt: new Date(),
    },
  });

  await broadcastConversation(conversationId);
}

export async function markVisitorSeen(visitorId: string): Promise<void> {
  await prisma.visitor.update({
    where: { id: visitorId },
    data: { lastSeenAt: new Date() },
  });
}
