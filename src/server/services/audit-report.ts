import { Prisma } from "@prisma/client";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  AUDIT_ACTION_LABELS,
  auditFilterSchema,
  reportTime,
  type AuditFilterInput,
} from "../../lib/reporting";
import {
  assertManager,
  auditSelect,
  auditWhere,
} from "./reporting-access";

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
