import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  unansweredRuleSchema,
  unansweredFilterSchema,
  unansweredDue,
  type UnansweredRuleInput,
  type UnansweredRuleDetails,
  type UnansweredFilters,
} from "../../lib/unanswered";

function scope(actor: SessionUser): Prisma.ConversationWhereInput {
  if (
    !actor.tenantId ||
    !["ADMIN", "MERCHANT_ADMIN", "AGENT"].includes(actor.role)
  )
    throw new HttpError(403, "无权访问未回复提醒");
  return {
    ...(actor.role === "ADMIN" ? {} : { site: { tenantId: actor.tenantId } }),
    ...(actor.siteIds === null ? {} : { siteId: { in: actor.siteIds } }),
  };
}
function siteScope(actor: SessionUser, siteId: string): Prisma.SiteWhereInput {
  scope(actor);
  if (actor.role === "AGENT") throw new HttpError(403, "需要管理员权限");
  return {
    id: siteId,
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(actor.siteIds === null ? {} : { AND: [{ id: { in: actor.siteIds } }] }),
  };
}
function ownerScope(tenantId: string, siteId: string): Prisma.UserWhereInput {
  return {
    tenantId,
    active: true,
    OR: [
      { role: { in: ["ADMIN", "MERCHANT_ADMIN"] } },
      { role: "AGENT", sites: { some: { siteId } } },
    ],
  };
}
function ruleValue(
  rule: {
    enabled: boolean;
    ownerId: string | null;
    recipientMode: string;
    delayMinutes: number;
    version: number;
  } | null,
) {
  return {
    enabled: rule?.enabled ?? false,
    ownerId: rule?.ownerId ?? "",
    recipientMode: (rule?.recipientMode ??
      "ASSIGNED_OR_OWNER") as UnansweredRuleInput["recipientMode"],
    delayMinutes: rule?.delayMinutes ?? 10,
    version: rule?.version ?? 0,
  };
}
export async function getUnansweredRule(
  actor: SessionUser,
  siteId: string,
): Promise<UnansweredRuleDetails> {
  const where = siteScope(actor, siteId);
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: { id: true, tenantId: true, unansweredRule: true },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    const owners = await tx.user.findMany({
      where: ownerScope(site.tenantId, site.id),
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { rule: ruleValue(site.unansweredRule), owners };
  });
}
export async function saveUnansweredRule(
  actor: SessionUser,
  siteId: string,
  input: UnansweredRuleInput,
  now = new Date(),
) {
  const where = siteScope(actor, siteId),
    data = unansweredRuleSchema.parse(input);
  if (!(await rateLimit(`unanswered-rule:${actor.id}`, 30, 60)).ok)
    throw new HttpError(429, "操作过于频繁，请稍后重试");
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: { id: true, tenantId: true },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    await tx.$queryRaw`SELECT id FROM "Site" WHERE id = ${site.id} FOR UPDATE`;
    const current = await tx.unansweredRule.findUnique({ where: { siteId } });
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new HttpError(409, "配置已被其他管理员更新，请重新加载后再操作");
    const owner = data.ownerId
      ? await tx.user.findFirst({
          where: {
            AND: [ownerScope(site.tenantId, site.id), { id: data.ownerId }],
          },
          select: { id: true },
        })
      : null;
    if (data.enabled && !owner)
      throw new HttpError(400, "负责人须为本商家启用且有该站点权限的成员");
    const values = {
      enabled: data.enabled,
      ownerId: owner?.id ?? null,
      recipientMode: data.recipientMode,
      delayMinutes: data.delayMinutes,
      enabledAt:
        data.enabled && !current?.enabled ? now : (current?.enabledAt ?? null),
    };
    const rule = current
      ? await tx.unansweredRule.update({
          where: { id: current.id, version: data.expectedVersion },
          data: { ...values, version: { increment: 1 } },
        })
      : await tx.unansweredRule.create({ data: { siteId, ...values } });
    if (!data.enabled)
      await tx.unansweredReminder.updateMany({
        where: { ruleId: rule.id, resolvedAt: null },
        data: { resolvedAt: now, resolution: "DISABLED" },
      });
    await tx.auditLog.create({
      data: {
        tenantId: site.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "unanswered.rule.update",
        targetType: "UnansweredRule",
        targetId: rule.id,
        meta: { siteId, ...ruleValue(rule) },
      },
    });
    return ruleValue(rule);
  });
}

function serviceActive(now: Date): Prisma.SiteWhereInput {
  return {
    active: true,
    unansweredRule: { is: { enabled: true } },
    tenant: {
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  };
}

/** Bounded, cursor-based scan. Conversation and rule locks serialize replies and rule disabling. */
export async function generateUnansweredReminders(
  now = new Date(),
  cursor?: string,
  tenantIds?: string[],
) {
  if (tenantIds && !tenantIds.length) return { created: 0, cursor: undefined };
  // Compare each site's delay and enable boundary in SQL so old/future rounds do not consume batches.
  const batch = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT c.id FROM "Conversation" c
    JOIN "Site" s ON s.id = c."siteId"
    JOIN "Tenant" t ON t.id = s."tenantId"
    JOIN "UnansweredRule" r ON r."siteId" = s.id
    WHERE c.status IN ('PENDING', 'OPEN') AND c."waitingMessageId" IS NOT NULL
      AND r.enabled = true AND r."enabledAt" IS NOT NULL
      AND c."waitingSince" >= r."enabledAt"
      AND c."waitingSince" <= ${now} - r."delayMinutes" * INTERVAL '1 minute'
      AND s.active = true AND t.status = 'ACTIVE' AND (t."expiresAt" IS NULL OR t."expiresAt" > ${now})
      AND NOT EXISTS (SELECT 1 FROM "UnansweredReminder" n WHERE n."conversationId" = c.id AND n."resolvedAt" IS NULL)
      ${cursor ? Prisma.sql`AND c.id > ${cursor}` : Prisma.empty}
      ${tenantIds ? Prisma.sql`AND s."tenantId" IN (${Prisma.join(tenantIds)})` : Prisma.empty}
    ORDER BY c.id ASC LIMIT 100
  `);
  let created = 0;
  for (const candidate of batch) {
    created += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${candidate.id} FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({
        where: {
          id: candidate.id,
          status: { in: ["PENDING", "OPEN"] },
          site: serviceActive(now),
        },
        select: {
          id: true,
          siteId: true,
          waitingSince: true,
          waitingMessageId: true,
          assignedAgentId: true,
          site: { select: { tenantId: true } },
        },
      });
      if (!conversation) return 0;
      await tx.$queryRaw`SELECT id FROM "UnansweredRule" WHERE "siteId" = ${conversation.siteId} FOR SHARE`;
      const rule = await tx.unansweredRule.findUnique({
        where: { siteId: conversation.siteId },
      });
      if (
        !rule ||
        !unansweredDue(
          conversation.waitingSince,
          conversation.waitingMessageId,
          rule,
          now,
        )
      )
        return 0;
      const recipientIds = [
        ...new Set([
          ...(rule.recipientMode === "ASSIGNED_OR_OWNER" &&
          conversation.assignedAgentId
            ? [conversation.assignedAgentId]
            : []),
          ...(rule.ownerId ? [rule.ownerId] : []),
        ]),
      ];
      if (!recipientIds.length) return 0;
      const owners = await tx.user.findMany({
        where: {
          AND: [
            ownerScope(conversation.site.tenantId, conversation.siteId),
            { id: { in: recipientIds } },
          ],
        },
        select: { id: true },
      });
      const recipientId = recipientIds.find((id) =>
        owners.some((owner) => owner.id === id),
      );
      if (!recipientId) return 0;
      const result = await tx.unansweredReminder.createMany({
        data: {
          tenantId: conversation.site.tenantId,
          conversationId: conversation.id,
          recipientId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          waitingMessageId: conversation.waitingMessageId!,
          waitingSince: conversation.waitingSince!,
          remindedAt: now,
        },
        skipDuplicates: true,
      });
      if (!result.count) return 0;
      const reminder = await tx.unansweredReminder.findUniqueOrThrow({
        where: {
          conversationId_waitingMessageId: {
            conversationId: conversation.id,
            waitingMessageId: conversation.waitingMessageId!,
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: conversation.site.tenantId,
          actorName: "系统",
          action: "unanswered.remind",
          targetType: "UnansweredReminder",
          targetId: reminder.id,
          meta: {
            conversationId: conversation.id,
            recipientId,
            waitingSince: conversation.waitingSince!.toISOString(),
            ruleId: rule.id,
            ruleVersion: rule.version,
          },
        },
      });
      return 1;
    });
  }
  return {
    created,
    cursor: batch.length === 100 ? batch[batch.length - 1].id : undefined,
  };
}

function activeReminder(now: Date): Prisma.UnansweredReminderWhereInput {
  return {
    resolvedAt: null,
    conversation: {
      status: { in: ["PENDING", "OPEN"] },
      waitingMessageId: { not: null },
      site: serviceActive(now),
    },
  };
}
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

export function startUnansweredReminderWorker() {
  let stopping = false,
    cursor: string | undefined,
    running: Promise<void> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (stopping || running) return;
    running = generateUnansweredReminders(new Date(), cursor)
      .then((result) => {
        cursor = result.cursor;
      })
      .catch((error) => {
        cursor = undefined;
        console.error("[unanswered-reminders] 检查失败:", error);
      })
      .finally(() => {
        running = null;
        if (!stopping) {
          timer = setTimeout(tick, cursor ? 1000 : 30000);
          timer.unref();
        }
      });
  };
  tick();
  return async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
