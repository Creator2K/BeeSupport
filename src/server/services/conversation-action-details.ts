import { HttpError } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import type { SerializedConversation } from "../../lib/realtime/types";
import { prisma } from "../../lib/db";
import { filterOnlineVisitors } from "../presence";
import { serializeVisitor } from "../serialize";
import { broadcastConversation } from "./broadcast";
import { loadConversationForAgent } from "./conversation-action-core";
import { listVisitorConversations } from "./visitors";

export async function getVisitorProfileForAgent(
  user: SessionUser,
  conversationId: string,
): Promise<{
  visitor: SerializedConversation["visitor"];
  conversations: Awaited<ReturnType<typeof listVisitorConversations>>;
}> {
  const conversation = await loadConversationForAgent(user, conversationId);
  const [online, conversations] = await Promise.all([
    filterOnlineVisitors([conversation.visitorId]),
    listVisitorConversations({
      visitorId: conversation.visitorId,
      excludeConversationId: conversationId,
    }),
  ]);

  return {
    visitor: serializeVisitor(conversation.visitor, {
      visitorOnline: online.has(conversation.visitorId),
    }),
    conversations,
  };
}

export async function updateConversationMeta(
  user: SessionUser,
  conversationId: string,
  input: {
    tags?: string[];
    note?: string;
    priority?: number;
    subject?: string;
  },
): Promise<SerializedConversation> {
  await loadConversationForAgent(user, conversationId);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      tags: input.tags,
      note: input.note,
      priority: input.priority,
      subject: input.subject,
    },
  });

  const updated = await broadcastConversation(conversationId);
  if (!updated) throw new HttpError(404, "会话不存在");
  return updated;
}
