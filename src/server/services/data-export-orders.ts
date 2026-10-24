import type { Prisma } from "@prisma/client";

import type { SessionUser } from "../../lib/auth";
import {
  MAX_EXPORT_ROWS,
  reportOrderStatuses,
  reportTime,
} from "../../lib/reporting";
import {
  assertExportRowLimit,
  type ExportDateRange,
  type ExportTable,
} from "./data-export-types";

export async function collectOrderExport(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  data: {
    status:
      | ""
      | "PENDING"
      | "CONFIRMED"
      | "REJECTED"
      | "CANCELLED"
      | "EXPIRED";
    query: string;
  },
  dates: ExportDateRange,
  now: Date,
): Promise<ExportTable> {
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
  assertExportRowLimit(await tx.subscriptionOrder.count({ where }));
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
  const headers = [
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
  const rows = records.map((row) => [
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
  return { headers, rows };
}
