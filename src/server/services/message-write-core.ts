import type { Prisma } from "@prisma/client";

import { HttpError } from "../../lib/auth";
import { lockConversation } from "../transactions";
import { getWidgetSettings, tenantCanServe } from "./tenants";
import {
  inferType,
  linkAttachments,
  updateConversationAfterMessage,
} from "./message-write-helpers";
import {
  MAX_BODY_LENGTH,
  type CreateMessageInput,
} from "./message-write-types";

/**
 * 写入一条消息并维护会话上的未读数、首响时间、最后消息摘要等派生字段。
 * 访客与客服两条路径共用这段逻辑。
 */
export async function writeMessage(
  tx: Prisma.TransactionClient,
  input: CreateMessageInput,
) {
  const body = (input.body ?? "").trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];

  if (!body && attachmentIds.length === 0) {
    throw new HttpError(400, "消息内容不能为空");
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new HttpError(400, `单条消息最长 ${MAX_BODY_LENGTH} 字`);
  }

  if (input.sender === "VISITOR" && input.uploaderId)
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.uploaderId} FOR UPDATE`;
  await lockConversation(tx, input.conversationId);
  // The row lock serializes retries; the unique index also protects other writers.
  if (input.clientId) {
    const existing = await tx.message.findUnique({
      where: {
        conversationId_clientId: {
          conversationId: input.conversationId,
          clientId: input.clientId,
        },
      },
      select: { id: true, sender: true, authorId: true },
    });
    if (existing) {
      if (
        existing.sender !== input.sender ||
        existing.authorId !== (input.authorId ?? null)
      ) {
        throw new HttpError(409, "消息标识已被使用");
      }
      return { id: existing.id, created: false as const };
    }
  }

  const conversation = await tx.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      site: {
        select: {
          autoAssign: true,
          name: true,
          imageReviewEnabled: true,
          active: true,
          tenant: { select: { status: true, expiresAt: true } },
        },
      },
      visitor: { select: { email: true } },
    },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (conversation.siteId !== input.siteId) {
    throw new HttpError(403, "会话不属于该站点");
  }

  if (!conversation.site.active || !tenantCanServe(conversation.site.tenant))
    throw new HttpError(403, "商家服务已暂停或已到期");

  const images = attachmentIds.length
    ? await tx.attachment.count({
        where: {
          id: { in: attachmentIds },
          mimeType: { startsWith: "image/" },
        },
      })
    : 0;

  if (input.sender === "VISITOR" && attachmentIds.length) {
    const settings = await getWidgetSettings(input.siteId, tx);
    if (
      (images > 0 && !settings.imagesEnabled) ||
      (attachmentIds.length > images && !settings.filesEnabled)
    )
      throw new HttpError(403, "此站点已关闭相应附件发送功能");
  }

  if (
    input.sender === "VISITOR" &&
    images &&
    conversation.site.imageReviewEnabled
  ) {
    if (images !== 1)
      throw new HttpError(
        409,
        "当前站点每次只能发送一张图片，需客服允许后继续",
      );
    const visitorId = input.uploaderId ?? conversation.visitorId;
    const [visitor, image] = await Promise.all([
      tx.visitor.findUnique({
        where: { id: visitorId },
        select: { pendingImageId: true },
      }),
      tx.attachment.findFirst({
        where: {
          id: { in: attachmentIds },
          mimeType: { startsWith: "image/" },
          siteId: input.siteId,
          uploader: "VISITOR",
          uploaderId: visitorId,
        },
        select: { id: true },
      }),
    ]);
    if (!visitor || !image) throw new HttpError(400, "图片不属于当前访客");
    if (
      visitor.pendingImageId &&
      visitor.pendingImageId !== image.id &&
      (await tx.attachment.findFirst({
        where: { id: visitor.pendingImageId, imageReviewState: "PENDING" },
        select: { id: true },
      }))
    )
      throw new HttpError(409, "请等待客服允许后再发送下一张图片");
    await tx.visitor.update({
      where: { id: visitorId },
      data: { pendingImageId: image.id },
    });
    await tx.attachment.update({
      where: { id: image.id },
      data: { imageReviewState: "PENDING" },
    });
  }

  const message = await tx.message.create({
    data: {
      conversationId: input.conversationId,
      sender: input.sender,
      type: inferType(input.type, attachmentIds.length, images),
      body,
      authorId: input.authorId ?? null,
      authorName: input.authorName ?? null,
      clientId: input.clientId ?? null,
      readByAgentAt: input.sender === "AGENT" ? new Date() : null,
    },
  });

  await linkAttachments(tx, {
    attachmentIds,
    siteId: input.siteId,
    messageId: message.id,
    uploaderType: input.sender,
    uploaderId: input.uploaderId ?? input.authorId ?? conversation.visitorId,
  });

  const preview = await updateConversationAfterMessage({
    tx,
    input,
    conversation,
    message,
    body,
    attachmentCount: attachmentIds.length,
  });

  return {
    id: message.id,
    created: true as const,
    input,
    conversation,
    preview,
  };
}
