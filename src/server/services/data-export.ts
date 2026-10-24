import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  exportInputSchema,
  makeCsv,
  type ExportInput,
} from "../../lib/reporting";
import { assertManager, range } from "./reporting-access";
import { collectAuditExport } from "./data-export-audit";
import { collectConversationExport } from "./data-export-conversations";
import { collectOrderExport } from "./data-export-orders";

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
      const { headers, rows } =
        data.kind === "conversations"
          ? await collectConversationExport(tx, actor, data, dates)
          : data.kind === "orders"
            ? await collectOrderExport(tx, actor, data, dates, now)
            : await collectAuditExport(tx, actor, data, now);
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
