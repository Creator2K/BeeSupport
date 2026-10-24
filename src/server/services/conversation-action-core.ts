import type { Prisma } from "@prisma/client";

import { assertSiteServing } from "./tenants";
import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { SerializedConversation } from "../../lib/realtime/types";
import { lockConversation } from "../transactions";
import {
  conversationInclude,
  serializeConversation,
  type ConversationRecord,
} from "../serialize";
import {
  broadcastConversation,
  broadcastMessage,
} from "./broadcast";

export async function loadConversationForAgent(
  user: SessionUser,
  conversationId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<ConversationRecord> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (!canAccessSite(user, conversation.siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }
  return conversation;
}

/** Keep status changes and their timeline entries in the same order as message writes. */
export async function transitionConversation(
  user: SessionUser,
  conversationId: string,
  change: (
    conversation: ConversationRecord,
    tx: Prisma.TransactionClient,
  ) => Promise<{
    data: Prisma.ConversationUncheckedUpdateInput;
    body: string;
  } | null>,
  notify?: (
    conversation: SerializedConversation,
    tx: Prisma.TransactionClient,
  ) => Promise<void>,
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, conversationId);
    const current = await loadConversationForAgent(user, conversationId, tx);
    await assertSiteServing(current.siteId, tx);
    const transition = await change(current, tx);
    if (!transition) return { record: current, messageId: null };
    const message = await tx.message.create({
      data: {
        conversationId,
        sender: "SYSTEM",
        type: "SYSTEM",
        body: transition.body,
      },
    });
    const record = await tx.conversation.update({
      where: { id: conversationId },
      data: transition.data,
      include: conversationInclude,
    });
    if (transition.data.status === "CLOSED" && current.waitingMessageId) {
      await tx.unansweredReminder.updateMany({
        where: { conversationId, resolvedAt: null },
        data: { resolvedAt: new Date(), resolution: "CLOSED" },
      });
    }
    await notify?.(serializeConversation(record, { visitorOnline: false }), tx);
    return { record, messageId: message.id };
  });

  // A failed real-time delivery cannot undo a committed action or make retries duplicate it.
  const [broadcast] = await Promise.allSettled([
    broadcastConversation(conversationId),
    ...(result.messageId ? [broadcastMessage(result.messageId)] : []),
  ]);
  return {
    conversation: serializeConversation(result.record, {
      visitorOnline:
        broadcast.status === "fulfilled"
          ? (broadcast.value?.visitor.online ?? false)
          : false,
    }),
    changed: result.messageId !== null,
  };
}
