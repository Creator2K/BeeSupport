import { prisma } from "../../lib/db";
import type { VisitorConversationSummary } from "../../lib/realtime/types";
import { mergeVisitorEnv, type VisitorEnv } from "../../lib/visitor-env";

/** 超过这个空闲时长算一次新访问 */
const VISIT_GAP_MS = 30 * 60 * 1000;

function truncate(
  value: string | undefined,
  length: number,
): string | undefined {
  if (!value) return undefined;
  return value.length > length ? value.slice(0, length) : value;
}

/**
 * 访客身份落地：合并环境信息、记录最近页面、按需累计访问次数。
 * 由 /api/widget/session 调用（填完邮箱拿到令牌的那一刻）。
 */
export async function touchVisitorOnSession(input: {
  visitorId: string;
  env: VisitorEnv;
  pageUrl?: string;
  pageTitle?: string;
  referrer?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.visitorId} FOR UPDATE`;
    const visitor = await tx.visitor.findUnique({
      where: { id: input.visitorId },
      select: {
        lastSeenAt: true,
        meta: true,
        landingPage: true,
        lastPage: true,
        referrer: true,
      },
    });
    if (!visitor) return;

    const now = new Date();
    const isNewVisit =
      now.getTime() - visitor.lastSeenAt.getTime() > VISIT_GAP_MS;

    const meta = mergeVisitorEnv(
      (visitor.meta ?? {}) as VisitorEnv,
      input.env,
    ) as VisitorEnv;

    const pageUrl = truncate(input.pageUrl, 500);
    const pageTitle = truncate(input.pageTitle, 200);
    const referrer = truncate(input.referrer, 500);
    const changedPage = Boolean(pageUrl) && pageUrl !== visitor.lastPage;

    await tx.visitor.update({
      where: { id: input.visitorId },
      data: {
        lastSeenAt: now,
        meta,
        landingPage: visitor.landingPage ?? pageUrl ?? null,
        referrer: visitor.referrer ?? referrer ?? null,
        lastPage: pageUrl ?? undefined,
        lastPageTitle: pageTitle ?? undefined,
        pageViews: changedPage ? { increment: 1 } : undefined,
        visitCount: isNewVisit ? { increment: 1 } : undefined,
      },
    });
  });
}

/**
 * 页面切换上报：同一会话内换了路径就累加浏览数。
 * 由 /api/widget/track 调用（SPA 路由变化、页面刷新）。
 */
export async function recordVisitedPage(input: {
  visitorId: string;
  pageUrl: string;
  pageTitle?: string;
  env?: VisitorEnv;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.visitorId} FOR UPDATE`;
    const visitor = await tx.visitor.findUnique({
      where: { id: input.visitorId },
      select: {
        lastSeenAt: true,
        lastPage: true,
        meta: true,
      },
    });
    if (!visitor) return;

    const now = new Date();
    const pageUrl = truncate(input.pageUrl, 500) ?? "";
    const changed = pageUrl.length > 0 && pageUrl !== visitor.lastPage;
    const isNewVisit =
      now.getTime() - visitor.lastSeenAt.getTime() > VISIT_GAP_MS;

    await tx.visitor.update({
      where: { id: input.visitorId },
      data: {
        lastSeenAt: now,
        lastPage: pageUrl || undefined,
        lastPageTitle: truncate(input.pageTitle, 200) ?? undefined,
        pageViews: changed ? { increment: 1 } : undefined,
        visitCount: isNewVisit ? { increment: 1 } : undefined,
        meta: input.env
          ? (mergeVisitorEnv(
              (visitor.meta ?? {}) as VisitorEnv,
              input.env,
            ) as VisitorEnv)
          : undefined,
      },
    });
  });
}

/** 访客的历史会话（工作台访客面板用） */
export async function listVisitorConversations(input: {
  visitorId: string;
  excludeConversationId?: string;
  take?: number;
}): Promise<VisitorConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      visitorId: input.visitorId,
      ...(input.excludeConversationId
        ? { id: { not: input.excludeConversationId } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 15,
    select: {
      id: true,
      status: true,
      subject: true,
      tags: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      createdAt: true,
      rating: true,
      assignedAgent: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    subject: row.subject,
    tags: row.tags,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    createdAt: row.createdAt.toISOString(),
    rating: row.rating,
    messageCount: row._count.messages,
    agentName: row.assignedAgent?.name ?? null,
  }));
}
