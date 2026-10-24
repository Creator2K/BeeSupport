import type { Prisma } from "@prisma/client";

import type { SessionUser } from "../../lib/auth";
import {
  AUDIT_ACTION_LABELS,
  MAX_EXPORT_ROWS,
  reportTime,
} from "../../lib/reporting";
import {
  assertExportRowLimit,
  type ExportTable,
} from "./data-export-types";
import { auditSelect, auditWhere } from "./reporting-access";

export async function collectAuditExport(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  data: { from: string; to: string; query: string; action: string },
  now: Date,
): Promise<ExportTable> {
  const where = auditWhere(actor, data, now);
  assertExportRowLimit(await tx.auditLog.count({ where }));
  const records = await tx.auditLog.findMany({
    where,
    select: auditSelect,
    take: MAX_EXPORT_ROWS,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const headers = [
    "记录编号",
    "时间（北京时间）",
    "操作人员",
    "操作",
    "操作代码",
    "对象类型",
    "对象编号",
    "IP",
  ];
  const rows = records.map((row) => [
    row.id,
    reportTime(row.createdAt),
    row.actorName,
    AUDIT_ACTION_LABELS[row.action] ?? row.action,
    row.action,
    row.targetType,
    row.targetId,
    row.ip,
  ]);
  return { headers, rows };
}
