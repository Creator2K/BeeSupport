import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  retryDeliverySchema,
  type RetryDeliveryInput,
} from "../../lib/deliveries";
import { assertPlatform } from "./delivery-shared";
import { assertRetryable } from "./delivery-retry-eligibility";

export async function retryDelivery(
  actor: SessionUser,
  input: RetryDeliveryInput,
) {
  assertPlatform(actor);
  const data = retryDeliverySchema.parse(input);
  if (!(await rateLimit(`deliveries:retry:${actor.id}`, 30, 600)).ok)
    throw new HttpError(429, "重试过于频繁，请稍后操作");
  await prisma.$transaction(async (tx) => {
    const row = await tx.notificationJob.findUnique({ where: { id: data.id } });
    if (!row) throw new HttpError(404, "通知记录不存在或已清理");
    if (
      row.status !== "FAILED" ||
      row.updatedAt.toISOString() !== data.updatedAt ||
      row.manualRetries !== data.manualRetries
    )
      throw new HttpError(
        409,
        "任务状态已更新，请刷新后重试；等待或发送中的任务会自动处理",
      );
    await assertRetryable(row, tx);
    const changed = await tx.notificationJob.updateMany({
      where: {
        id: data.id,
        status: "FAILED",
        updatedAt: new Date(data.updatedAt),
        manualRetries: data.manualRetries,
      },
      data: {
        status: "PENDING",
        outcome: null,
        attempts: 0,
        totalAttempts: Math.max(row.totalAttempts, row.attempts),
        manualRetries: { increment: 1 },
        availableAt: new Date(),
        completedAt: null,
        lockedUntil: null,
        leaseToken: null,
        lastError: null,
      },
    });
    if (changed.count !== 1)
      throw new HttpError(409, "任务已被其他管理员处理，请刷新查看");
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "notification.retry",
        targetType: "NotificationJob",
        targetId: row.id,
        meta: {
          kind: row.kind,
          totalAttempts: row.totalAttempts,
          manualRetry: row.manualRetries + 1,
        },
      },
    });
  });
}
