import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { reportDateRange } from "../../lib/reporting";

export function assertManager(actor: SessionUser) {
  if (
    (actor.role !== "ADMIN" && actor.role !== "MERCHANT_ADMIN") ||
    !actor.tenantId
  )
    throw new HttpError(403, "仅管理员可检索日志和导出数据");
}
export function range(from: string, to: string, now: Date) {
  try {
    return reportDateRange(from, to, now);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "日期范围无效",
    );
  }
}
export function auditWhere(
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
export const auditSelect = {
  id: true,
  actorName: true,
  action: true,
  targetType: true,
  targetId: true,
  ip: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;
