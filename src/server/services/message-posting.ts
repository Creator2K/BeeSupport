import type { MessageType } from "@prisma/client";

import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { VisitorSession } from "../../lib/visitor-auth";
import { broadcastMessage } from "./broadcast";
import { insertMessage, MAX_BODY_LENGTH } from "./message-write";

export async function postVisitorMessage(input: {
  visitor: VisitorSession;
  conversationId: string;
  body: string;
  clientId?: string | null;
  attachmentIds?: string[];
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true, visitorId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (
    conversation.visitorId !== input.visitor.visitorId ||
    conversation.siteId !== input.visitor.siteId
  ) {
    throw new HttpError(403, "无权访问该会话");
  }

  await prisma.visitor.update({
    where: { id: input.visitor.visitorId },
    data: { lastSeenAt: new Date() },
  });

  return insertMessage({
    conversationId: conversation.id,
    siteId: conversation.siteId,
    sender: "VISITOR",
    body: input.body,
    clientId: input.clientId ?? null,
    attachmentIds: input.attachmentIds ?? [],
    authorId: null,
    authorName: null,
    uploaderId: input.visitor.visitorId,
  });
}

export async function postAgentMessage(input: {
  user: SessionUser;
  conversationId: string;
  body: string;
  type?: MessageType;
  clientId?: string | null;
  attachmentIds?: string[];
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (!canAccessSite(input.user, conversation.siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }

  await prisma.user.update({
    where: { id: input.user.id },
    data: { lastSeenAt: new Date() },
  });

  return insertMessage({
    conversationId: conversation.id,
    siteId: conversation.siteId,
    sender: "AGENT",
    type: input.type,
    body: input.body,
    clientId: input.clientId ?? null,
    attachmentIds: input.attachmentIds ?? [],
    authorId: input.user.id,
    authorName: input.user.name,
    uploaderId: input.user.id,
  });
}

/** 内部备注：访客不可见，只作为一条 NOTE 消息存进会话 */
export async function postInternalNote(input: {
  user: SessionUser;
  conversationId: string;
  body: string;
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (!canAccessSite(input.user, conversation.siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      sender: "AGENT",
      type: "NOTE",
      body: input.body.slice(0, MAX_BODY_LENGTH),
      authorId: input.user.id,
      authorName: input.user.name,
      readByAgentAt: new Date(),
    },
  });

  await broadcastMessage(message.id);
  return message.id;
}

export async function createSystemMessage(
  conversationId: string,
  body: string,
): Promise<void> {
  const message = await prisma.message.create({
    data: { conversationId, sender: "SYSTEM", type: "SYSTEM", body },
  });
  await broadcastMessage(message.id);
}
