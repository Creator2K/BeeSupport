import type { ConversationStatus, Prisma } from "@prisma/client";

import { assertTenantQuota, assertSiteServing } from "./tenants";
import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { SerializedConversation } from "../../lib/realtime/types";
import type { VisitorSession } from "../../lib/visitor-auth";
import {
  visitorConversation,
  type VisitorConversation,
} from "../../lib/realtime/public";
import { getSiteAvailability } from "../../lib/widget";
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
  broadcastConversationCreated,
  broadcastMessage,
} from "./broadcast";
import {
  createSystemMessage,
  writeMessage,
  publishMessage,
  listConversationMessages,
} from "./messages";
import {
  notifyConversationClosed,
  notifyConversationCreated,
  notifyConversationAssigned,
} from "./notifications";
import { listVisitorConversations } from "./visitors";
import { createOfflineFollowUp } from "./follow-up-rules";

export type ConversationListFilters = {
  status?: ConversationStatus;
  siteId?: string;
  assignedTo?: "me" | "unassigned" | "all";
  query?: string;
  tag?: string;
  onlyUnread?: boolean;
  page?: number;
  pageSize?: number;
  excludeClosed?: boolean;
};

export type ConversationListResult = {
  items: SerializedConversation[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * 自动分配：挑选「在线 + 有该站点权限 + 当前进行中会话最少」的客服。
 * 没有在线客服时返回 null，会话进入排队（PENDING）。
 */
export async function pickAgentForAssignment(
  siteId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { tenantId: true },
  });
  if (!site) return null;
  const candidates = await db.user.findMany({
    where: {
      tenantId: site.tenantId,
      role: { not: "ADMIN" },
      active: true,
      status: "ONLINE",
      lastSeenAt: { gte: new Date(Date.now() - 90_000) },
      OR: [{ role: "MERCHANT_ADMIN" }, { sites: { some: { siteId } } }],
    },
    select: {
      id: true,
      lastSeenAt: true,
      _count: { select: { conversations: { where: { status: "OPEN" } } } },
    },
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const loadDiff = a._count.conversations - b._count.conversations;
    if (loadDiff !== 0) return loadDiff;
    return (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0);
  });

  return candidates[0]!.id;
}

export async function conversationCounts(
  user: SessionUser,
  siteId?: string,
): Promise<{ pending: number; open: number; unread: number; mine: number }> {
  if (siteId) {
    if (user.siteIds !== null && !user.siteIds.includes(siteId)) {
      throw new HttpError(403, "无权访问该站点");
    }
  }

  const [counts] = await prisma.$queryRaw<
    {
      pending: bigint;
      open: bigint;
      unread: bigint;
      mine: bigint;
    }[]
  >`
    SELECT COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE status = 'OPEN') AS open,
      COUNT(*) FILTER (WHERE status <> 'CLOSED' AND "unreadForAgent" > 0) AS unread,
      COUNT(*) FILTER (WHERE status <> 'CLOSED' AND "assignedAgentId" = ${user.id}) AS mine
    FROM "Conversation"
    WHERE (${user.siteIds === null} OR "siteId" = ANY(${user.siteIds ?? []}::text[]))
      AND (${siteId ?? null}::text IS NULL OR "siteId" = ${siteId ?? null})
  `;
  return {
    pending: Number(counts?.pending ?? 0),
    open: Number(counts?.open ?? 0),
    unread: Number(counts?.unread ?? 0),
    mine: Number(counts?.mine ?? 0),
  };
}

export async function listConversations(
  user: SessionUser,
  filters: ConversationListFilters,
): Promise<ConversationListResult> {
  const page = Number.isFinite(filters.page)
    ? Math.max(1, Math.trunc(filters.page!))
    : 1;
  const pageSize = Number.isFinite(filters.pageSize)
    ? Math.min(100, Math.max(5, Math.trunc(filters.pageSize!)))
    : 30;
  const where: Prisma.ConversationWhereInput = {};

  if (filters.siteId) {
    if (!canAccessSite(user, filters.siteId)) {
      throw new HttpError(403, "无权访问该站点");
    }
    where.siteId = filters.siteId;
  } else if (user.siteIds !== null) {
    where.siteId = { in: user.siteIds };
  }

  if (filters.status) where.status = filters.status;
  else if (filters.excludeClosed) where.status = { not: "CLOSED" };

  if (filters.assignedTo === "me") where.assignedAgentId = user.id;
  else if (filters.assignedTo === "unassigned") where.assignedAgentId = null;

  if (filters.onlyUnread) where.unreadForAgent = { gt: 0 };
  if (filters.tag) where.tags = { has: filters.tag };

  const keyword = filters.query?.trim();
  if (keyword) {
    where.OR = [
      { visitor: { email: { contains: keyword, mode: "insensitive" } } },
      { visitor: { name: { contains: keyword, mode: "insensitive" } } },
      { lastMessagePreview: { contains: keyword, mode: "insensitive" } },
      { subject: { contains: keyword, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: conversationInclude,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const online = await filterOnlineVisitors(rows.map((row) => row.visitorId));
  const items = rows.map((row) =>
    serializeConversation(row, { visitorOnline: online.has(row.visitorId) }),
  );

  return { items, total, page, pageSize };
}

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

/** 访客发起会话：已有进行中的会话则复用，否则新建并按站点策略自动分配 */
export async function createConversationForVisitor(input: {
  site: {
    id: string;
    name: string;
    autoAssign: boolean;
    notifyEmail: string | null;
    workHours?: unknown;
  };
  visitor: { id: string; email: string; name: string | null };
  body: string;
  subject?: string | null;
  attachmentIds?: string[];
  clientId?: string;
  source: "WIDGET" | "OFFLINE_FORM";
}): Promise<{ conversationId: string; created: boolean }> {
  const availability = await getSiteAvailability({
    id: input.site.id,
    workHours: input.site.workHours,
  });
  const result = await prisma.$transaction(async (tx) => {
    // Two tabs sending the first message must reuse one conversation.
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.visitor.id} FOR UPDATE`;
    const existing = await tx.conversation.findFirst({
      where: {
        siteId: input.site.id,
        visitorId: input.visitor.id,
        OR: [
          { status: { in: ["PENDING", "OPEN"] } },
          ...(input.clientId
            ? [{ messages: { some: { clientId: input.clientId } } }]
            : []),
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });

    if (existing) {
      const message = await writeMessage(tx, {
        conversationId: existing.id,
        siteId: input.site.id,
        sender: "VISITOR",
        body: input.body,
        attachmentIds: input.attachmentIds ?? [],
        clientId: input.clientId,
        uploaderId: input.visitor.id,
      });
      return { conversationId: existing.id, created: false as const, message };
    }

    const quotaSite = await tx.site.findUniqueOrThrow({
      where: { id: input.site.id },
      select: { tenantId: true },
    });
    await assertTenantQuota(tx, quotaSite.tenantId, "conversations");
    const assignedAgentId =
      input.site.autoAssign && availability.online
        ? await pickAgentForAssignment(input.site.id, tx)
        : null;

    const preview = (input.body ?? "").slice(0, 120);
    const conversation = await tx.conversation.create({
      data: {
        siteId: input.site.id,
        visitorId: input.visitor.id,
        source: availability.online ? "WIDGET" : "OFFLINE_FORM",
        subject: input.subject?.slice(0, 200) ?? (preview || null),
        status: assignedAgentId ? "OPEN" : "PENDING",
        assignedAgentId,
      },
    });

    const message = await writeMessage(tx, {
      conversationId: conversation.id,
      siteId: input.site.id,
      sender: "VISITOR",
      body: input.body,
      attachmentIds: input.attachmentIds ?? [],
      clientId: input.clientId,
      uploaderId: input.visitor.id,
    });
    if (!availability.online) await createOfflineFollowUp(tx, conversation.id);
    await notifyConversationCreated(
      {
        conversationId: conversation.id,
        siteId: input.site.id,
        siteName: input.site.name,
        notifyEmail: input.site.notifyEmail,
        visitorEmail: input.visitor.email,
        visitorName: input.visitor.name,
        subject: input.subject ?? null,
        preview,
        offline: !availability.online,
      },
      tx,
    );
    if (assignedAgentId) {
      const agent = await tx.user.findUnique({
        where: { id: assignedAgentId },
        select: { name: true },
      });
      await notifyConversationAssigned(
        {
          conversation: {
            id: conversation.id,
            siteId: input.site.id,
            siteName: input.site.name,
            assignedAgent: { id: assignedAgentId },
          },
          agentName: agent?.name ?? "",
        },
        tx,
      );
    }
    return {
      conversationId: conversation.id,
      created: true as const,
      message,
      assignedAgentId,
      preview,
    };
  });

  await publishMessage(result.message);
  if (!result.created)
    return { conversationId: result.conversationId, created: false };
  const { conversationId, assignedAgentId } = result;

  if (assignedAgentId) {
    const agent = await prisma.user.findUnique({
      where: { id: assignedAgentId },
      select: { name: true },
    });
    await createSystemMessage(
      conversationId,
      `已为你接入客服 ${agent?.name ?? ""}`.trim(),
    );
  }

  await broadcastConversationCreated(conversationId);

  return { conversationId, created: true };
}

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

export async function rateConversation(
  visitor: VisitorSession,
  conversationId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  if (rating < 1 || rating > 5) throw new HttpError(400, "评分必须在 1-5 之间");

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, visitorId: true, siteId: true },
  });
  if (
    !conversation ||
    conversation.visitorId !== visitor.visitorId ||
    conversation.siteId !== visitor.siteId
  ) {
    throw new HttpError(404, "会话不存在");
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      rating,
      ratingComment: comment?.slice(0, 500) ?? null,
      ratedAt: new Date(),
    },
  });

  await broadcastConversation(conversationId);
}

export async function markVisitorSeen(visitorId: string): Promise<void> {
  await prisma.visitor.update({
    where: { id: visitorId },
    data: { lastSeenAt: new Date() },
  });
}
