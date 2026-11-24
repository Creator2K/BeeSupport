import { prisma } from "../../lib/db";
import {
  emitConversationCreated,
  emitConversationUpdated,
  emitMessage,
} from "../../lib/realtime/emit";
import type { SerializedConversation } from "../../lib/realtime/types";
import { isVisitorOnline } from "../presence";
import {
  conversationInclude,
  messageInclude,
  serializeConversation,
  serializeMessage,
} from "../serialize";

/**
 * 广播统一入口：任何一处改动会话/消息，都通过这里读回最新状态再推给客户端，
 * 保证所有端看到的 payload 结构完全一致。
 */
export async function loadSerializedConversation(
  conversationId: string,
): Promise<SerializedConversation | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!conversation) return null;

  const visitorOnline = await isVisitorOnline(conversation.visitorId);
  return serializeConversation(conversation, { visitorOnline });
}

export async function broadcastConversation(
  conversationId: string,
  extraRooms: string[] = [],
): Promise<SerializedConversation | null> {
  const conversation = await loadSerializedConversation(conversationId);
  if (conversation) {
    emitConversationUpdated(conversation, extraRooms);
  }
  return conversation;
}

export async function broadcastConversationCreated(
  conversationId: string,
): Promise<SerializedConversation | null> {
  const conversation = await loadSerializedConversation(conversationId);
  if (conversation) {
    emitConversationCreated(conversation);
  }
  return conversation;
}

export async function broadcastMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: messageInclude,
  });
  if (!message) return;

  const conversation = await loadSerializedConversation(
    message.conversationId,
  );
  if (!conversation) return;

  emitMessage({
    conversationId: message.conversationId,
    message: serializeMessage(message),
    conversation,
  }, message.deletedAt ? "message:deleted" : "message:new");
}
