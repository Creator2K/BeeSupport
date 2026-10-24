import { Prisma } from "@prisma/client";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  followUpFilterSchema,
  followUpToday,
  type FollowUpFilter,
} from "../../lib/follow-ups";
import {
  boardScope,
  manager,
  taskDto,
  taskSelect,
} from "./follow-up-access";

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
