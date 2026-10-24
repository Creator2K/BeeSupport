import type { Prisma } from "@prisma/client";

import { HttpError, type SessionUser } from "../../lib/auth";
import {
  MAX_EXPORT_ROWS,
  conversationStatuses,
  reportTime,
} from "../../lib/reporting";
import {
  assertExportRowLimit,
  type ExportDateRange,
  type ExportTable,
} from "./data-export-types";

export async function collectConversationExport(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  data: {
    siteId: string;
    status: "" | "PENDING" | "OPEN" | "CLOSED";
    query: string;
  },
  dates: ExportDateRange,
): Promise<ExportTable> {
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
  assertExportRowLimit(await tx.conversation.count({ where }));
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
  const headers = [
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
  const rows = records.map((row) => [
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
  return { headers, rows };
}
