import type { Prisma } from "@prisma/client";

import { assertSiteServing } from "./tenants";
import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { SerializedConversation } from "../../lib/realtime/types";
import { filterOnlineVisitors } from "../presence";
import { lockConversation } from "../transactions";
import {
  conversationInclude,
  serializeConversation,
  serializeVisitor,
  type ConversationRecord,
} from "../serialize";
import {
  broadcastConversation,
  broadcastMessage,
} from "./broadcast";
import { listConversationMessages } from "./messages";
import {
  notifyConversationClosed,
  notifyConversationAssigned,
} from "./notifications";
import { listVisitorConversations } from "./visitors";

async function loadConversationForAgent(
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
async function transitionConversation(
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

export async function claimConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status === "CLOSED")
        throw new HttpError(400, "会话已结束，无法接入");
      if (current.status === "OPEN" && current.assignedAgentId) {
        if (current.assignedAgentId === user.id) return null;
        throw new HttpError(409, "会话已被其他客服接入，请刷新后重试");
      }
      return {
        data: {
          assignedAgentId: user.id,
          status: "OPEN",
          closedAt: null,
          closedById: null,
        },
        body: `客服 ${user.name} 已接入会话`,
      };
    },
    (conversation, tx) =>
      notifyConversationAssigned({ conversation, agentName: user.name }, tx),
  );
  return result.conversation;
}

export async function transferConversation(
  user: SessionUser,
  conversationId: string,
  targetAgentId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (conversation, tx) => {
      if (conversation.status === "CLOSED")
        throw new HttpError(400, "请先重新打开会话再转接");
      const target = await tx.user.findUnique({
        where: { id: targetAgentId },
        select: {
          id: true,
          name: true,
          active: true,
          role: true,
          tenantId: true,
          sites: { select: { siteId: true } },
        },
      });
      if (!target || !target.active)
        throw new HttpError(404, "目标客服不存在或已禁用");

      const targetCanAccess =
        target.role === "ADMIN" ||
        (target.tenantId === conversation.site.tenantId &&
          (target.role === "MERCHANT_ADMIN" ||
            target.sites.some((site) => site.siteId === conversation.siteId)));
      if (!targetCanAccess) {
        throw new HttpError(400, "目标客服没有该站点的权限");
      }
      if (
        target.id === conversation.assignedAgentId &&
        conversation.status === "OPEN"
      )
        return null;
      return {
        data: {
          assignedAgentId: target.id,
          status: "OPEN",
          closedAt: null,
          closedById: null,
        },
        body: `会话已由 ${user.name} 转交给 ${target.name}`,
      };
    },
    (conversation, tx) =>
      conversation.assignedAgent
        ? notifyConversationAssigned(
            { conversation, agentName: conversation.assignedAgent.name },
            tx,
          )
        : Promise.resolve(),
  );
  return result.conversation;
}

export async function closeConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status === "CLOSED") return null;
      return {
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: user.id,
          unreadForAgent: 0,
          waitingSince: null,
          waitingMessageId: null,
        },
        body: `会话已被 ${user.name} 结束`,
      };
    },
    (conversation, tx) =>
      notifyConversationClosed(
        {
          conversationId,
          siteId: conversation.siteId,
          siteName: conversation.siteName,
          visitorEmail: conversation.visitor.email,
          agentName: user.name,
        },
        tx,
      ),
  );

  return result.conversation;
}

export async function reopenConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status !== "CLOSED") {
        if (current.status === "OPEN" && current.assignedAgentId === user.id)
          return null;
        throw new HttpError(409, "会话状态已变化，请刷新后重试");
      }
      return {
        data: {
          status: "OPEN",
          closedAt: null,
          closedById: null,
          assignedAgentId: user.id,
        },
        body: `会话已被 ${user.name} 重新打开`,
      };
    },
  );
  return result.conversation;
}

/** 访客档案 + 历史会话，供工作台右侧面板展示 */
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
