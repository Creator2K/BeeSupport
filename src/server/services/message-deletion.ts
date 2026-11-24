import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { logger } from "../../lib/logger";
import { deleteUpload } from "../../lib/storage";
import { messageInclude, serializeMessage } from "../serialize";
import { lockConversation } from "../transactions";
import { broadcastMessage } from "./broadcast";
import { loadConversationForAgent } from "./conversation-action-core";

export async function deleteAgentMessage(user: SessionUser, conversationId: string, messageId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, conversationId);
    const conversation = await loadConversationForAgent(user, conversationId, tx);
    const message = await tx.message.findFirst({
      where: { id: messageId, conversationId },
      include: messageInclude,
    });
    if (!message) throw new HttpError(404, "消息不存在");
    if (message.sender !== "AGENT" || message.authorId !== user.id)
      throw new HttpError(403, "只能删除自己发送的消息");
    if (message.deletedAt) return { message, attachments: [] };

    const attachments = message.attachments;
    if (attachments.length) await tx.attachment.deleteMany({ where: { messageId } });
    const deleted = await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: "", meta: Prisma.DbNull },
      include: messageInclude,
    });

    if (message.type !== "NOTE") {
      // System events and private notes never set the public preview.
      const latest = await tx.message.findFirst({
        where: { conversationId, type: { in: ["TEXT", "IMAGE", "FILE"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessagePreview: latest?.id === messageId ? null : undefined,
          unreadForVisitor: !message.readByVisitorAt && conversation.unreadForVisitor > 0
            ? { decrement: 1 } : undefined,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: conversation.site.tenantId, actorId: user.id, actorName: user.name,
        action: "message.delete", targetType: "Message", targetId: messageId,
        meta: { conversationId },
      },
    });
    return { message: deleted, attachments };
  });

  await Promise.all([
    broadcastMessage(messageId).catch((error: unknown) =>
      logger.error("message.deletion_broadcast_failed", { messageId }, error)),
    ...result.attachments.map((file) => deleteUpload(file.storageKey).catch((error: unknown) =>
      logger.error("uploads.deleted_message_cleanup_failed", { attachmentId: file.id }, error))),
  ]);
  return serializeMessage(result.message);
}
