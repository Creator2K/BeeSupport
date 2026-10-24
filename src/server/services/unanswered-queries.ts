import type { Prisma } from "@prisma/client";

import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  unansweredFilterSchema,
  type UnansweredFilters,
} from "../../lib/unanswered";
import {
  activeReminder,
  scope,
} from "./unanswered-scope";

export async function countUnansweredReminders(
  actor: SessionUser,
  now = new Date(),
) {
  return prisma.unansweredReminder.count({
    where: {
      AND: [
        { conversation: scope(actor) },
        activeReminder(now),
        { tenantId: actor.tenantId, recipientId: actor.id },
      ],
    },
  });
}
export async function listUnansweredReminders(
  actor: SessionUser,
  input: UnansweredFilters,
  requestedPage = 1,
  now = new Date(),
) {
  const conversationScope = scope(actor),
    filters = unansweredFilterSchema.parse(input);
  const base: Prisma.UnansweredReminderWhereInput = {
    AND: [
      { conversation: conversationScope },
      ...(actor.role !== "ADMIN" ? [{ tenantId: actor.tenantId }] : []),
      ...(actor.role === "AGENT" || filters.mine === "1"
        ? [{ recipientId: actor.id }]
        : []),
      ...(filters.siteId ? [{ conversation: { siteId: filters.siteId } }] : []),
      ...(filters.query
        ? [
            {
              conversation: {
                OR: [
                  {
                    subject: {
                      contains: filters.query,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    visitor: {
                      name: {
                        contains: filters.query,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                  {
                    visitor: {
                      email: {
                        contains: filters.query,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                ],
              },
            },
          ]
        : []),
    ],
  };
  const where: Prisma.UnansweredReminderWhereInput = {
    AND: [
      base,
      filters.status === "ACTIVE"
        ? activeReminder(now)
        : filters.status === "RESOLVED"
          ? { resolvedAt: { not: null } }
          : {},
    ],
  };
  return prisma.$transaction(
    async (tx) => {
      const [total, active] = await Promise.all([
        tx.unansweredReminder.count({ where }),
        tx.unansweredReminder.count({
          where: { AND: [base, activeReminder(now)] },
        }),
      ]);
      const pageSize = 20,
        page = Math.min(
          Math.max(
            1,
            Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1,
          ),
          Math.max(1, Math.ceil(total / pageSize)),
        );
      const records = await tx.unansweredReminder.findMany({
        where,
        orderBy: [{ remindedAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          conversationId: true,
          waitingSince: true,
          remindedAt: true,
          resolvedAt: true,
          resolution: true,
          recipient: { select: { name: true, active: true } },
          conversation: {
            select: {
              subject: true,
              status: true,
              waitingMessageId: true,
              visitor: { select: { name: true, email: true } },
              site: {
                select: {
                  name: true,
                  active: true,
                  unansweredRule: { select: { enabled: true } },
                  tenant: { select: { status: true, expiresAt: true } },
                },
              },
            },
          },
        },
      });
      return {
        total,
        active,
        page,
        pageSize,
        rows: records.map((record) => ({
          id: record.id,
          conversationId: record.conversationId,
          waitingSince: record.waitingSince.toISOString(),
          remindedAt: record.remindedAt.toISOString(),
          resolvedAt: record.resolvedAt?.toISOString() ?? null,
          resolution: record.resolution,
          active:
            !record.resolvedAt &&
            record.conversation.status !== "CLOSED" &&
            Boolean(record.conversation.waitingMessageId) &&
            record.conversation.site.active &&
            Boolean(record.conversation.site.unansweredRule?.enabled) &&
            record.conversation.site.tenant.status === "ACTIVE" &&
            (!record.conversation.site.tenant.expiresAt ||
              record.conversation.site.tenant.expiresAt > now),
          recipientName: record.recipient?.name ?? "负责人已删除",
          recipientActive: record.recipient?.active ?? false,
          subject: record.conversation.subject,
          visitorName: record.conversation.visitor.name,
          visitorEmail: record.conversation.visitor.email,
          siteName: record.conversation.site.name,
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
