import type { MessageType, Prisma } from "@prisma/client";

import { HttpError } from "../../lib/auth";
import { notifyVisitorMessage } from "./notifications";
import type {
  CreateMessageInput,
  MessageConversation,
  WrittenMessage,
} from "./message-write-types";

export async function linkAttachments(
  tx: Prisma.TransactionClient,
  input: {
    attachmentIds: string[];
    siteId: string;
    messageId: string;
    uploaderType: "VISITOR" | "AGENT";
    uploaderId: string;
  },
): Promise<number> {
  if (input.attachmentIds.length === 0) return 0;

  const result = await tx.attachment.updateMany({
    where: {
      id: { in: input.attachmentIds },
      siteId: input.siteId,
      uploader: input.uploaderType,
      uploaderId: input.uploaderId,
      messageId: null,
    },
    data: { messageId: input.messageId },
  });
  if (result.count !== input.attachmentIds.length) {
    throw new HttpError(400, "附件不存在、已发送或不属于当前用户");
  }
  return result.count;
}

export function inferType(
  explicit: MessageType | undefined,
  attachmentCount: number,
  imageCount: number,
): MessageType {
  if (explicit) return explicit;
  if (attachmentCount === 0) return "TEXT";
  return imageCount > 0 && imageCount === attachmentCount ? "IMAGE" : "FILE";
}

export async function updateConversationAfterMessage({
  tx,
  input,
  conversation,
  message,
  body,
  attachmentCount,
}: {
  tx: Prisma.TransactionClient;
  input: CreateMessageInput;
  conversation: MessageConversation;
  message: WrittenMessage;
  body: string;
  attachmentCount: number;
}): Promise<string> {
  const preview = body
    ? body.slice(0, 120)
    : attachmentCount > 0
      ? "[文件]"
      : "";

  const now = new Date();
  const data: Prisma.ConversationUpdateInput = {
    lastMessageAt: now,
    lastMessagePreview: preview,
    updatedAt: now,
  };

  if (input.sender === "VISITOR") {
    if (!conversation.waitingMessageId || conversation.status === "CLOSED") {
      data.waitingSince = message.createdAt;
      data.waitingMessageId = message.id;
    }
    data.unreadForAgent = { increment: 1 };
    // 访客重新发消息：已结束的会话自动回到待接入
    if (conversation.status === "CLOSED") {
      data.status = "PENDING";
      data.closedAt = null;
      data.closedById = null;
    }
  } else {
    if (["TEXT", "IMAGE", "FILE"].includes(message.type)) {
      data.waitingSince = null;
      data.waitingMessageId = null;
      if (conversation.waitingMessageId) {
        await tx.unansweredReminder.updateMany({
          where: { conversationId: input.conversationId, resolvedAt: null },
          data: { resolvedAt: now, resolution: "REPLIED" },
        });
      }
    }
    await tx.message.updateMany({
      where: {
        conversationId: input.conversationId,
        sender: "VISITOR",
        readByAgentAt: null,
      },
      data: { readByAgentAt: now },
    });
    data.unreadForVisitor = { increment: 1 };
    data.unreadForAgent = 0;
    if (!conversation.firstResponseAt) {
      data.firstResponseAt = now;
    }
    if (conversation.status !== "OPEN") {
      data.status = "OPEN";
      data.closedAt = null;
      data.closedById = null;
    }
    if (!conversation.assignedAgentId && input.authorId) {
      data.assignedAgent = { connect: { id: input.authorId } };
    }
  }

  await tx.conversation.update({
    where: { id: input.conversationId },
    data,
  });

  if (input.sender === "VISITOR") {
    await notifyVisitorMessage(
      {
        conversationId: input.conversationId,
        siteId: input.siteId,
        siteName: conversation.site.name,
        visitorEmail: conversation.visitor.email,
        preview,
      },
      tx,
    );
  }

  return preview;
}
