import type { Prisma } from "@prisma/client";

import { prisma } from "./db";
import { logger } from "./logger";

/**
 * 后台操作审计。写日志失败不应该影响主流程，因此只记错误不抛出。
 */
export type AuditInput = {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const actor = input.actorId
      ? await prisma.user.findUnique({
          where: { id: input.actorId },
          select: { tenantId: true },
        })
      : null;
    await prisma.auditLog.create({
      data: {
        tenantId: actor?.tenantId ?? "legacy",
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        meta: input.meta,
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    logger.error("audit.write_failed", { action: input.action }, error);
  }
}
