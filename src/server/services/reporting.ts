import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  AUDIT_ACTION_LABELS,
  MAX_EXPORT_ROWS,
  auditFilterSchema,
  exportInputSchema,
  reportDateRange,
  reportTime,
  makeCsv,
  conversationStatuses,
  reportOrderStatuses,
  type AuditFilterInput,
  type ExportInput,
} from "../../lib/reporting";

function assertManager(actor: SessionUser) {
  if (
    (actor.role !== "ADMIN" && actor.role !== "MERCHANT_ADMIN") ||
    !actor.tenantId
  )
    throw new HttpError(403, "仅管理员可检索日志和导出数据");
}
function range(from: string, to: string, now: Date) {
  try {
    return reportDateRange(from, to, now);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "日期范围无效",
    );
  }
}
function auditWhere(
  actor: SessionUser,
  input: { from: string; to: string; query: string; action: string },
  now: Date,
): Prisma.AuditLogWhereInput {
  return {
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    createdAt: range(input.from, input.to, now),
    ...(input.action ? { action: input.action } : {}),
    ...(input.query
      ? {
          OR: [
            { actorName: { contains: input.query, mode: "insensitive" } },
            { targetType: { contains: input.query, mode: "insensitive" } },
            { targetId: { contains: input.query, mode: "insensitive" } },
            { action: { contains: input.query, mode: "insensitive" } },
            { ip: { contains: input.query } },
          ],
        }
      : {}),
  };
}
const auditSelect = {
  id: true,
  actorName: true,
  action: true,
  targetType: true,
  targetId: true,
  ip: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export async function getAuditRecords(
  actor: SessionUser,
  input: AuditFilterInput,
  requestedPage = 1,
  now = new Date(),
) {
  assertManager(actor);
  const data = auditFilterSchema.parse(input),
    where = auditWhere(actor, data, now),
    pageSize = 20;
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.auditLog.count({ where });
      const page = Math.min(
        Math.max(1, Math.min(100000, Number(requestedPage) || 1)) | 0,
        Math.max(1, Math.ceil(total / pageSize)),
      );
      const rows = await tx.auditLog.findMany({
        where,
        select: auditSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      });
      return {
        page,
        pageSize,
        total,
        rows: rows.map((row) => ({
          ...row,
          createdAt: reportTime(row.createdAt),
          actionLabel: AUDIT_ACTION_LABELS[row.action] ?? row.action,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function generateDataExport(
  actor: SessionUser,
  input: ExportInput,
  ip?: string,
  now = new Date(),
) {
  assertManager(actor);
  const data = exportInputSchema.parse(input),
    dates = range(data.from, data.to, now);
  if (!(await rateLimit(`data-export:${actor.id}`, 10, 600)).ok)
    throw new HttpError(429, "导出过于频繁，请稍后重试");
  const exportId = randomUUID();
  return prisma.$transaction(
    async (tx) => {
      let headers: string[], rows: unknown[][];
      const bound = (count: number) => {
        if (count > MAX_EXPORT_ROWS)
          throw new HttpError(
            413,
            `结果超过 ${MAX_EXPORT_ROWS} 条，请缩小日期范围或增加筛选条件`,
          );
      };
      if (data.kind === "conversations") {
        if (
          data.siteId &&
          !(await tx.site.findFirst({
            where: {
              id: data.siteId,
              ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
            },
            select: { id: true },
          }))
        )
          throw new HttpError(403, "无权导出该站点的数据");
        const where: Prisma.ConversationWhereInput = {
          createdAt: dates,
          ...(actor.role === "ADMIN"
            ? {}
            : { site: { tenantId: actor.tenantId } }),
          ...(data.siteId ? { siteId: data.siteId } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(data.query
            ? {
                OR: [
                  {
                    visitor: {
                      email: { contains: data.query, mode: "insensitive" },
                    },
                  },
                  {
                    visitor: {
                      name: { contains: data.query, mode: "insensitive" },
                    },
                  },
                  { subject: { contains: data.query, mode: "insensitive" } },
                  { id: { contains: data.query } },
                ],
              }
            : {}),
        };
        bound(await tx.conversation.count({ where }));
        const records = await tx.conversation.findMany({
          where,
          take: MAX_EXPORT_ROWS,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            status: true,
            source: true,
            subject: true,
            createdAt: true,
            lastMessageAt: true,
            closedAt: true,
            rating: true,
            site: { select: { name: true } },
            visitor: { select: { email: true, name: true } },
            assignedAgent: { select: { name: true } },
          },
        });
        headers = [
          "会话编号",
          "站点",
          "访客邮箱",
          "访客姓名",
          "状态",
          "来源",
          "主题",
          "接待人员",
          "创建时间（北京时间）",
          "最近消息时间（北京时间）",
          "结束时间（北京时间）",
          "评分",
        ];
        rows = records.map((row) => [
          row.id,
          row.site.name,
          row.visitor.email,
          row.visitor.name,
          conversationStatuses[row.status],
          row.source === "OFFLINE_FORM" ? "离线留言" : "聊天窗口",
          row.subject,
          row.assignedAgent?.name,
          reportTime(row.createdAt),
          reportTime(row.lastMessageAt),
          reportTime(row.closedAt),
          row.rating,
        ]);
      } else if (data.kind === "orders") {
        const status: Prisma.SubscriptionOrderWhereInput =
          data.status === "EXPIRED"
            ? {
                OR: [
                  { status: "EXPIRED" },
                  { status: "PENDING", validUntil: { lte: now } },
                ],
              }
            : data.status === "PENDING"
              ? { status: "PENDING", validUntil: { gt: now } }
              : data.status
                ? { status: data.status }
                : {};
        const where: Prisma.SubscriptionOrderWhereInput = {
          AND: [
            { createdAt: dates },
            actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId },
            status,
            data.query
              ? {
                  OR: [
                    { orderNo: { contains: data.query, mode: "insensitive" } },
                    { planName: { contains: data.query, mode: "insensitive" } },
                    {
                      tenant: {
                        name: { contains: data.query, mode: "insensitive" },
                      },
                    },
                  ],
                }
              : {},
          ],
        };
        bound(await tx.subscriptionOrder.count({ where }));
        const records = await tx.subscriptionOrder.findMany({
          where,
          take: MAX_EXPORT_ROWS,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            orderNo: true,
            tenant: { select: { name: true } },
            status: true,
            validUntil: true,
            planName: true,
            priceCents: true,
            durationDays: true,
            maxAgents: true,
            maxSites: true,
            monthlyConversations: true,
            storageMB: true,
            createdAt: true,
            reviewedAt: true,
            periodStart: true,
            periodEnd: true,
          },
        });
        headers = [
          "订单号",
          "商家",
          "状态",
          "套餐快照名称",
          "金额（元）",
          "有效天数",
          "账号上限",
          "站点上限",
          "月会话上限",
          "存储上限（MB）",
          "创建时间（北京时间）",
          "审核时间（北京时间）",
          "服务开始（北京时间）",
          "服务结束（北京时间）",
        ];
        rows = records.map((row) => [
          row.orderNo,
          row.tenant.name,
          reportOrderStatuses[
            row.status === "PENDING" && row.validUntil <= now
              ? "EXPIRED"
              : row.status
          ] ?? row.status,
          row.planName,
          (row.priceCents / 100).toFixed(2),
          row.durationDays,
          row.maxAgents,
          row.maxSites,
          row.monthlyConversations,
          row.storageMB,
          reportTime(row.createdAt),
          reportTime(row.reviewedAt),
          reportTime(row.periodStart),
          reportTime(row.periodEnd),
        ]);
      } else {
        const where = auditWhere(actor, data, now);
        bound(await tx.auditLog.count({ where }));
        const records = await tx.auditLog.findMany({
          where,
          select: auditSelect,
          take: MAX_EXPORT_ROWS,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        headers = [
          "记录编号",
          "时间（北京时间）",
          "操作人员",
          "操作",
          "操作代码",
          "对象类型",
          "对象编号",
          "IP",
        ];
        rows = records.map((row) => [
          row.id,
          reportTime(row.createdAt),
          row.actorName,
          AUDIT_ACTION_LABELS[row.action] ?? row.action,
          row.action,
          row.targetType,
          row.targetId,
          row.ip,
        ]);
      }
      const csv = makeCsv(headers, rows);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.id,
          actorName: actor.name,
          action: "data.export",
          targetType: "DataExport",
          targetId: exportId,
          ip,
          meta: {
            kind: data.kind,
            from: data.from,
            to: data.to,
            rows: rows.length,
            queryApplied: Boolean(data.query),
            ...(data.kind === "conversations"
              ? { siteId: data.siteId, status: data.status }
              : data.kind === "orders"
                ? { status: data.status }
                : { action: data.action }),
          },
        },
      });
      return {
        csv,
        rowCount: rows.length,
        filename: `beesupport-${data.kind}-${data.from}-${data.to}-${exportId.slice(0, 8)}.csv`,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}
