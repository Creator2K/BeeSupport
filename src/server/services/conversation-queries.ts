import type { ConversationStatus, Prisma } from "@prisma/client";

import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import type { SerializedConversation } from "../../lib/realtime/types";
import { filterOnlineVisitors } from "../presence";
import { conversationInclude, serializeConversation } from "../serialize";

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

  // 关键词要对范围内的每一行做模糊匹配，长度不设限的话一次请求就能拖慢数据库。
  // 只取前 200 字：包含完整关键词的行也包含它的前 200 字，不会漏掉结果。
  // 截断点落在代理对中间时丢掉前半个，否则关键词末尾会变成一个匹配不到的字符
  const keyword = filters.query
    ?.trim()
    .slice(0, 200)
    .replace(/[\uD800-\uDBFF]$/, "");
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
