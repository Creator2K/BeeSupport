import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  followUpActionSchema,
  followUpFilterSchema,
  followUpToday,
  validateFollowUpDue,
  type FollowUpAction,
  type FollowUpFilter,
  type FollowUpTask,
} from "../../lib/follow-ups";

function manager(actor: SessionUser) {
  return actor.role === "ADMIN" || actor.role === "MERCHANT_ADMIN";
}
function scope(actor: SessionUser): Prisma.ConversationWhereInput {
  if (
    !actor.tenantId ||
    !["ADMIN", "MERCHANT_ADMIN", "AGENT"].includes(actor.role)
  )
    throw new HttpError(403, "无权访问跟进任务");
  return {
    ...(actor.role === "ADMIN" ? {} : { site: { tenantId: actor.tenantId } }),
    ...(actor.siteIds === null ? {} : { siteId: { in: actor.siteIds } }),
  };
}
const taskSelect = {
  id: true,
  conversationId: true,
  ownerId: true,
  note: true,
  dueAt: true,
  status: true,
  version: true,
  finishedAt: true,
  owner: { select: { name: true, active: true } },
} satisfies Prisma.FollowUpSelect;
type TaskRecord = Prisma.FollowUpGetPayload<{ select: typeof taskSelect }>;
function taskDto(row: TaskRecord): FollowUpTask {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    ownerActive: row.owner?.active ?? false,
    note: row.note,
    dueAt: row.dueAt.toISOString(),
    status: row.status as FollowUpTask["status"],
    version: row.version,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
function eligibleOwners(
  tenantId: string,
  siteId: string,
): Prisma.UserWhereInput {
  return {
    tenantId,
    active: true,
    OR: [
      { role: { in: ["MERCHANT_ADMIN", "ADMIN"] } },
      { role: "AGENT", sites: { some: { siteId } } },
    ],
  };
}
async function conversationFor(
  actor: SessionUser,
  conversationId: string,
  tx: Prisma.TransactionClient,
) {
  const conversation = await tx.conversation.findFirst({
    where: { AND: [scope(actor), { id: conversationId }] },
    select: { id: true, siteId: true, site: { select: { tenantId: true } } },
  });
  if (!conversation) throw new HttpError(404, "会话不存在或无权访问");
  return conversation;
}

export async function getFollowUpDetails(
  actor: SessionUser,
  conversationId: string,
) {
  scope(actor);
  return prisma.$transaction(async (tx) => {
    const conversation = await conversationFor(actor, conversationId, tx);
    const [task, owners] = await Promise.all([
      tx.followUp.findFirst({
        where: { conversationId, tenantId: conversation.site.tenantId },
        select: taskSelect,
      }),
      tx.user.findMany({
        where: {
          AND: [
            eligibleOwners(conversation.site.tenantId, conversation.siteId),
            manager(actor) ? {} : { id: actor.id },
          ],
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      task: task ? taskDto(task) : null,
      owners,
      canEdit: manager(actor) || !task || task.ownerId === actor.id,
      defaultOwnerId: owners.some((user) => user.id === actor.id)
        ? actor.id
        : (owners[0]?.id ?? ""),
    };
  });
}

export async function changeFollowUp(
  actor: SessionUser,
  conversationId: string,
  input: FollowUpAction,
  now = new Date(),
) {
  scope(actor);
  const data = followUpActionSchema.parse(input);
  let dueAt: Date | undefined;
  if (data.action === "save") {
    try {
      dueAt = validateFollowUpDue(data.dueAt, now);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "跟进时间无效",
      );
    }
    if (!manager(actor) && data.ownerId !== actor.id)
      throw new HttpError(403, "客服只能为自己安排跟进");
  }
  if (!(await rateLimit(`followup:${actor.id}`, 60, 60)).ok)
    throw new HttpError(429, "操作过于频繁，请稍后重试");
  return prisma.$transaction(async (tx) => {
    // A conversation lock serializes creation, edits and conversation deletion without adding public messages.
    const conversation = await conversationFor(actor, conversationId, tx);
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const current = await tx.followUp.findUnique({
      where: { conversationId },
      select: { ...taskSelect, tenantId: true },
    });
    if (current && current.tenantId !== conversation.site.tenantId)
      throw new HttpError(403, "任务归属无效");
    if (current && !manager(actor) && current.ownerId !== actor.id)
      throw new HttpError(403, "只能处理自己负责的跟进任务");
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new HttpError(409, "跟进任务已被更新，请刷新后再操作");
    let task;
    if (data.action === "save") {
      const owner = await tx.user.findFirst({
        where: {
          AND: [
            eligibleOwners(conversation.site.tenantId, conversation.siteId),
            { id: data.ownerId },
          ],
        },
        select: { id: true },
      });
      if (!owner)
        throw new HttpError(400, "负责人须为本商家启用且有该站点权限的成员");
      const values = {
        ownerId: owner.id,
        note: data.note,
        dueAt: dueAt!,
        status: "OPEN",
        finishedAt: null,
      };
      task = current
        ? await tx.followUp.update({
            where: { id: current.id, version: data.expectedVersion },
            data: { ...values, version: { increment: 1 } },
            select: taskSelect,
          })
        : await tx.followUp.create({
            data: {
              ...values,
              conversationId,
              tenantId: conversation.site.tenantId,
            },
            select: taskSelect,
          });
    } else {
      if (!current || current.status !== "OPEN")
        throw new HttpError(409, "任务已处理或不存在，请刷新后查看");
      task = await tx.followUp.update({
        where: { id: current.id, version: data.expectedVersion },
        data: {
          status: data.action === "complete" ? "DONE" : "CANCELLED",
          finishedAt: now,
          version: { increment: 1 },
        },
        select: taskSelect,
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: conversation.site.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: `followup.${data.action === "save" ? (current ? "update" : "create") : data.action}`,
        targetType: "FollowUp",
        targetId: task.id,
        meta: {
          conversationId,
          ownerId: task.ownerId,
          dueAt: task.dueAt.toISOString(),
          version: task.version,
          status: task.status,
        },
      },
    });
    return taskDto(task);
  });
}

function boardScope(
  actor: SessionUser,
  mine = false,
): Prisma.FollowUpWhereInput {
  return {
    conversation: scope(actor),
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(!manager(actor) || mine ? { ownerId: actor.id } : {}),
  };
}
export async function countDueFollowUps(actor: SessionUser, now = new Date()) {
  return prisma.followUp.count({
    where: {
      AND: [boardScope(actor, true), { status: "OPEN", dueAt: { lte: now } }],
    },
  });
}
export async function listFollowUps(
  actor: SessionUser,
  input: FollowUpFilter = {},
  requestedPage = 1,
  now = new Date(),
) {
  const filters = followUpFilterSchema.parse(input);
  const base: Prisma.FollowUpWhereInput = {
    AND: [
      boardScope(actor, filters.mine === "1"),
      filters.siteId ? { conversation: { siteId: filters.siteId } } : {},
      filters.query
        ? {
            OR: [
              { note: { contains: filters.query, mode: "insensitive" } },
              {
                conversation: {
                  OR: [
                    {
                      visitor: {
                        name: { contains: filters.query, mode: "insensitive" },
                      },
                    },
                    {
                      visitor: {
                        email: { contains: filters.query, mode: "insensitive" },
                      },
                    },
                    {
                      subject: { contains: filters.query, mode: "insensitive" },
                    },
                  ],
                },
              },
            ],
          }
        : {},
    ],
  };
  const conditions: Prisma.FollowUpWhereInput =
    filters.status === "overdue"
      ? { status: "OPEN", dueAt: { lte: now } }
      : filters.status === "today"
        ? { status: "OPEN", dueAt: followUpToday(now) }
        : { status: filters.status };
  const where = { AND: [base, conditions] },
    pageSize = 20;
  return prisma.$transaction(
    async (tx) => {
      const [total, open, overdue, today] = await Promise.all([
        tx.followUp.count({ where }),
        tx.followUp.count({ where: { AND: [base, { status: "OPEN" }] } }),
        tx.followUp.count({
          where: { AND: [base, { status: "OPEN", dueAt: { lte: now } }] },
        }),
        tx.followUp.count({
          where: { AND: [base, { status: "OPEN", dueAt: followUpToday(now) }] },
        }),
      ]);
      const page = Math.min(
        Math.max(1, Math.min(100000, Number(requestedPage) || 1)) | 0,
        Math.max(1, Math.ceil(total / pageSize)),
      );
      const rows = await tx.followUp.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          ...taskSelect,
          conversation: {
            select: {
              subject: true,
              source: true,
              status: true,
              site: { select: { name: true } },
              visitor: { select: { name: true, email: true } },
            },
          },
        },
      });
      return {
        rows: rows.map((row) => ({
          ...taskDto(row),
          visitorName: row.conversation.visitor.name,
          visitorEmail: row.conversation.visitor.email,
          subject: row.conversation.subject,
          siteName: row.conversation.site.name,
          source: row.conversation.source,
          conversationStatus: row.conversation.status,
          overdue: row.status === "OPEN" && row.dueAt <= now,
        })),
        total,
        page,
        pageSize,
        counts: { open, overdue, today },
        mineOnly: !manager(actor) || filters.mine === "1",
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
