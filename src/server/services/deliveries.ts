import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { getSmtpConfig } from "../../lib/mail";
import { rateLimit } from "../../lib/rate-limit";
import { emailSchema } from "../../lib/validation";
import {
  deliveryState,
  deliveryDiagnostic,
  deliveryKinds,
  retryDeliverySchema,
  type RetryDeliveryInput,
} from "../../lib/deliveries";
import { operationWindow } from "../../lib/operations";
import { prepareAccountMail } from "./account-mail";
import { prepareExpiryMail } from "./subscription-reminders";

function assertPlatform(actor: SessionUser) {
  if (actor.role !== "ADMIN")
    throw new HttpError(403, "仅平台管理员可查看和重试通知任务");
}
function stateWhere(state: string): Prisma.NotificationJobWhereInput {
  if (state === "SUCCESS" || state === "SKIPPED")
    return { status: "DELIVERED", outcome: state };
  if (state === "LEGACY") return { status: "DELIVERED", outcome: null };
  return ["PENDING", "PROCESSING", "FAILED"].includes(state)
    ? { status: state }
    : {};
}

export async function getDeliveries(
  actor: SessionUser,
  input: {
    days?: number;
    state?: string;
    kind?: string;
    search?: string;
    page?: number;
  },
  now = new Date(),
) {
  assertPlatform(actor);
  const days = [7, 30, 90].includes(input.days ?? 7) ? (input.days ?? 7) : 7;
  const base: Prisma.NotificationJobWhereInput = {
    createdAt: { gte: operationWindow(days, now).start, lte: now },
    ...(input.kind && Object.hasOwn(deliveryKinds, input.kind)
      ? { kind: input.kind }
      : {}),
    ...(input.search?.trim()
      ? {
          id: {
            contains: input.search.trim().slice(0, 100),
            mode: "insensitive",
          },
        }
      : {}),
  };
  const where = { AND: [base, stateWhere(input.state ?? "")] };
  const pageSize = 20;
  return prisma.$transaction(
    async (tx) => {
      const [total, groups, overdue] = await Promise.all([
        tx.notificationJob.count({ where }),
        tx.notificationJob.groupBy({
          by: ["status", "outcome"],
          where: base,
          _count: { _all: true },
        }),
        tx.notificationJob.count({
          where: {
            AND: [
              base,
              {
                OR: [
                  {
                    status: "PENDING",
                    availableAt: { lt: new Date(now.getTime() - 300000) },
                  },
                  { status: "PROCESSING", lockedUntil: { lt: now } },
                ],
              },
            ],
          },
        }),
      ]);
      const page = Math.min(
        Math.max(1, Math.min(100000, Number(input.page) || 1)) | 0,
        Math.max(1, Math.ceil(total / pageSize)),
      );
      const rows = await tx.notificationJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        // No payload, ciphertext, recipient address, endpoint URL or lease token leaves this service.
        select: {
          id: true,
          kind: true,
          status: true,
          outcome: true,
          attempts: true,
          totalAttempts: true,
          manualRetries: true,
          createdAt: true,
          updatedAt: true,
          availableAt: true,
          completedAt: true,
          lastError: true,
        },
      });
      const counts: Record<string, number> = {
        PENDING: 0,
        PROCESSING: 0,
        FAILED: 0,
        SUCCESS: 0,
        SKIPPED: 0,
        LEGACY: 0,
        UNKNOWN: 0,
      };
      for (const row of groups) counts[deliveryState(row)] += row._count._all;
      return {
        days,
        page,
        pageSize,
        total,
        counts,
        overdue,
        rows: rows.map((row) => ({
          id: row.id,
          kind: Object.hasOwn(deliveryKinds, row.kind) ? row.kind : "UNKNOWN",
          state: deliveryState(row),
          attempts: row.attempts,
          totalAttempts: Math.max(row.totalAttempts, row.attempts),
          manualRetries: row.manualRetries,
          diagnostic: deliveryDiagnostic(row.lastError, deliveryState(row)),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          availableAt: row.availableAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          canRetry:
            row.status === "FAILED" && Object.hasOwn(deliveryKinds, row.kind),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export type DeliveryList = Awaited<ReturnType<typeof getDeliveries>>;

async function assertRetryable(
  row: { id: string; kind: string; payload: Prisma.JsonValue },
  tx: Prisma.TransactionClient,
) {
  if (!Object.hasOwn(deliveryKinds, row.kind))
    throw new HttpError(400, "不支持此任务类型，请检查后台服务版本");
  if (row.kind !== "WEBHOOK" && !(await getSmtpConfig()))
    throw new HttpError(400, "请先在系统设置配置 SMTP 邮件服务");
  if (row.kind === "ACCOUNT_MAIL") {
    const prepared = await prepareAccountMail(row.payload, row.id);
    if (!prepared.ok)
      throw new HttpError(
        400,
        "账号链接已失效或发送条件已变更，请重新申请邮件或邀请",
      );
  } else if (row.kind === "SUBSCRIPTION_MAIL") {
    if (!(await prepareExpiryMail(row.payload)).ok)
      throw new HttpError(400, "到期提醒已失效或邮件提醒未启用，不可重试");
  } else if (row.kind === "MAIL") {
    if (
      !z
        .object({
          to: z.union([emailSchema, z.array(emailSchema).min(1)]),
          subject: z.string(),
          text: z.string(),
        })
        .safeParse(row.payload).success
    )
      throw new HttpError(400, "邮件任务数据已失效");
  } else {
    const parsed = z
      .object({
        endpointId: z.string(),
        webhook: z.object({ siteId: z.string(), event: z.string() }),
      })
      .safeParse(row.payload);
    if (!parsed.success) throw new HttpError(400, "通知任务数据已失效");
    const [endpoint, site] = await Promise.all([
      tx.webhookEndpoint.findUnique({ where: { id: parsed.data.endpointId } }),
      tx.site.findUnique({
        where: { id: parsed.data.webhook.siteId },
        select: { tenantId: true },
      }),
    ]);
    if (
      !endpoint?.active ||
      !site ||
      endpoint.tenantId !== site.tenantId ||
      (endpoint.siteId && endpoint.siteId !== parsed.data.webhook.siteId) ||
      (endpoint.events.length &&
        !endpoint.events.includes(parsed.data.webhook.event))
    )
      throw new HttpError(400, "通知渠道已停用、删除或不再订阅此事件");
  }
}

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
