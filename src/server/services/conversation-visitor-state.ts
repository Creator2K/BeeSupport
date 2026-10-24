import { prisma } from "../../lib/db";
import {
  visitorConversation,
  type VisitorConversation,
} from "../../lib/realtime/public";
import type { VisitorSession } from "../../lib/visitor-auth";
import { filterOnlineVisitors } from "../presence";
import {
  conversationInclude,
  serializeConversation,
} from "../serialize";
import { listConversationMessages } from "./messages";

/** 访客进入聊天窗时，找回进行中的会话历史 */
export async function getVisitorConversationState(
  visitor: VisitorSession,
  conversationId?: string,
  before?: string,
): Promise<{
  conversation: VisitorConversation | null;
  messages: Awaited<ReturnType<typeof listConversationMessages>>;
}> {
  const conversation = conversationId
    ? await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: conversationInclude,
      })
    : await prisma.conversation.findFirst({
        where: {
          siteId: visitor.siteId,
          visitorId: visitor.visitorId,
          status: { in: ["PENDING", "OPEN"] },
        },
        include: conversationInclude,
        orderBy: { lastMessageAt: "desc" },
      });

  if (
    !conversation ||
    conversation.visitorId !== visitor.visitorId ||
    conversation.siteId !== visitor.siteId
  ) {
    return { conversation: null, messages: [] };
  }

  const [messages, online] = await Promise.all([
    listConversationMessages({
      conversationId: conversation.id,
      forVisitor: true,
      before,
    }),
    filterOnlineVisitors([conversation.visitorId]),
  ]);

  return {
    conversation: visitorConversation(
      serializeConversation(conversation, {
        visitorOnline: online.has(conversation.visitorId),
      }),
    ),
    messages,
  };
}
