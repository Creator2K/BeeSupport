import type { SessionUser } from "../../lib/auth";
import type { SerializedConversation } from "../../lib/realtime/types";
import { filterOnlineVisitors } from "../presence";
import { serializeConversation } from "../serialize";
import { listConversationMessages } from "./messages";
import { loadConversationForAgent } from "./conversation-action-core";

export async function getConversationForAgent(
  user: SessionUser,
  conversationId: string,
  before?: string,
): Promise<{
  conversation: SerializedConversation;
  messages: Awaited<ReturnType<typeof listConversationMessages>>;
}> {
  const conversation = await loadConversationForAgent(user, conversationId);
  const [messages, online] = await Promise.all([
    listConversationMessages({ conversationId, before }),
    filterOnlineVisitors([conversation.visitorId]),
  ]);

  return {
    conversation: serializeConversation(conversation, {
      visitorOnline: online.has(conversation.visitorId),
    }),
    messages,
  };
}
