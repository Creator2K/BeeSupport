import { randomBytes } from "node:crypto";
import type { Prisma, SubscriptionOrder } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  planInputSchema,
  quotaConflict,
  renewalPeriod,
  effectiveOrderStatus,
  type PlanInput,
  type OrderView,
} from "../../lib/subscriptions";
import { getTenantUsage } from "./tenants";
import { paymentReportSchema } from "../../lib/collection";
import { readFeatures } from "../../lib/entitlements";

function manager(user: SessionUser) {
  if (user.role !== "ADMIN" && user.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "需要商家管理员权限");
}
function platform(user: SessionUser) {
  if (user.role !== "ADMIN") throw new HttpError(403, "需要平台管理员权限");
}
const quotaFields = (
  plan: Pick<
    PlanInput,
    "maxAgents" | "maxSites" | "monthlyConversations" | "storageMB"
  >,
) => ({
  maxAgents: plan.maxAgents,
  maxSites: plan.maxSites,
  monthlyConversations: plan.monthlyConversations,
  storageMB: plan.storageMB,
});
async function audit(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  order: SubscriptionOrder,
  action: string,
) {
  await tx.auditLog.create({
    data: {
      tenantId: order.tenantId,
      actorId: user.id,
      actorName: user.name,
      action,
      targetType: "SubscriptionOrder",
      targetId: order.id,
      meta: {
        orderNo: order.orderNo,
        planName: order.planName,
        priceCents: order.priceCents,
        status: order.status,
      },
    },
  });
}

export async function saveSubscriptionPlan(
  user: SessionUser,
  input: PlanInput,
  id?: string,
  expectedVersion?: string,
) {
  platform(user);
  const data = planInputSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    let plan;
    if (id) {
      if (!expectedVersion || !Number.isFinite(Date.parse(expectedVersion)))
        throw new HttpError(400, "缺少套餐版本，请刷新后重试");
      const result = await tx.subscriptionPlan.updateMany({
        where: { id, updatedAt: new Date(expectedVersion) },
        data,
      });
      if (!result.count)
        throw new HttpError(409, "套餐已被其他管理员修改，请刷新后重试");
      plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id } });
    } else plan = await tx.subscriptionPlan.create({ data });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: id ? "subscription.plan.update" : "subscription.plan.create",
        targetType: "SubscriptionPlan",
        targetId: plan.id,
        meta: {
          name: plan.name,
          priceCents: plan.priceCents,
          active: plan.active,
        },
      },
    });
    return plan;
  });
}

export async function submitSubscriptionOrder(
  user: SessionUser,
  input: {
    planId: string;
    expectedVersion: string;
    clientRequestId: string;
    note: string;
  },
) {
  manager(user);
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: user.tenantId },
      data: { updatedAt: new Date() },
    });
    if (tenant.status !== "ACTIVE")
      throw new HttpError(403, "商家未开通或已停用，请联系平台管理员");
    const retry = await tx.subscriptionOrder.findUnique({
      where: {
        tenantId_clientRequestId: {
          tenantId: tenant.id,
          clientRequestId: input.clientRequestId,
        },
      },
    });
    if (retry) {
      if (retry.planId !== input.planId)
        throw new HttpError(409, "订单请求标识已被使用");
      return retry;
    }
    const now = new Date();
    await tx.subscriptionOrder.updateMany({
      where: {
        tenantId: tenant.id,
        status: "PENDING",
        validUntil: { lte: now },
      },
      data: { status: "EXPIRED" },
    });
    if (
      await tx.subscriptionOrder.findFirst({
        where: { tenantId: tenant.id, status: "PENDING" },
        select: { id: true },
      })
    )
      throw new HttpError(409, "已有待确认订单，请先取消或等待平台处理");
    const plan = await tx.subscriptionPlan.findUnique({
      where: { id: input.planId },
    });
    if (!plan?.active)
      throw new HttpError(400, "该套餐已下架，请刷新后重新选择");
    if (plan.updatedAt.toISOString() !== input.expectedVersion)
      throw new HttpError(409, "套餐内容或价格已更新，请刷新后确认最新信息");
    const conflict = quotaConflict(plan, await getTenantUsage(tenant.id, tx));
    if (conflict)
      throw new HttpError(400, `${conflict}，请选择更高额度套餐或先减少用量`);
    const date = new Date(now.getTime() + 8 * 3600000)
      .toISOString()
      .replace(/\D/g, "")
      .slice(0, 14);
    const order = await tx.subscriptionOrder.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        clientRequestId: input.clientRequestId,
        orderNo: `BS${date}${randomBytes(5).toString("hex").toUpperCase()}`,
        planName: plan.name,
        features: readFeatures(plan.features),
        priceCents: plan.priceCents,
        durationDays: plan.durationDays,
        ...quotaFields(plan),
        requestedById: user.id,
        requestedByName: user.name,
        merchantNote: input.note,
        validUntil: new Date(now.getTime() + 7 * 86400000),
      },
    });
    await audit(tx, user, order, "subscription.order.submit");
    return order;
  });
}

/** A merchant report is a claim for manual review; it never changes the subscription. */
export async function reportSubscriptionPayment(
  user: SessionUser,
  id: string,
  input: unknown,
) {
  manager(user);
  const data = paymentReportSchema.parse(input);
  const initial = await prisma.subscriptionOrder.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { tenantId: true },
  });
  if (!initial) throw new HttpError(404, "订单不存在");
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: initial.tenantId },
      data: { updatedAt: new Date() },
    });
    const order = await tx.subscriptionOrder.findUniqueOrThrow({
      where: { id },
    });
    if (tenant.status !== "ACTIVE")
      throw new HttpError(403, "商家未开通或已停用，请联系平台");
    if (order.status !== "PENDING" || order.validUntil <= new Date())
      throw new HttpError(409, "订单已处理或报价已过期，请联系平台核对付款");
    if (order.priceCents <= 0)
      throw new HttpError(400, "免费订单无需反馈付款，请等待平台审核");
    if (order.paymentReportVersion !== data.expectedVersion) {
      if (
        order.paymentReportedAt &&
        order.paymentReportVersion === data.expectedVersion + 1 &&
        order.paymentNote === data.note
      )
        return { changed: false, order };
      throw new HttpError(409, "付款信息已更新，请刷新后重试");
    }
    if (order.paymentReportedAt && order.paymentNote === data.note)
      return { changed: false, order };
    const updated = await tx.subscriptionOrder.update({
      where: { id },
      data: {
        paymentReportedAt: new Date(),
        paymentNote: data.note,
        paymentReportVersion: { increment: 1 },
      },
    });
    await audit(tx, user, updated, "subscription.order.payment_report");
    return { changed: true, order: updated };
  });
}

/** Lock tenant before reading order state, using the same order as quota-consuming writes. */
export async function decideSubscriptionOrder(
  user: SessionUser,
  id: string,
  input: {
    decision: "CONFIRMED" | "REJECTED" | "CANCELLED";
    note: string;
    paymentReference: string;
    acknowledged: boolean;
  },
) {
  manager(user);
  if (input.decision !== "CANCELLED") platform(user);
  const initial = await prisma.subscriptionOrder.findFirst({
    where: {
      id,
      ...(user.role === "ADMIN" ? {} : { tenantId: user.tenantId }),
    },
    select: { tenantId: true },
  });
  if (!initial) throw new HttpError(404, "订单不存在");
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: initial.tenantId },
      data: { updatedAt: new Date() },
    });
    const current = await tx.subscriptionOrder.findUniqueOrThrow({
      where: { id },
    });
    if (current.status === input.decision)
      return { order: current, changed: false };
    if (current.status !== "PENDING")
      throw new HttpError(409, "订单已处理，请刷新后查看结果");
    const now = new Date();
    if (input.decision !== "CANCELLED" && current.validUntil <= now)
      throw new HttpError(400, "订单已过期，请让商家重新提交");
    let periodStart: Date | undefined, periodEnd: Date | undefined;
    if (input.decision === "CONFIRMED") {
      if (!input.acknowledged)
        throw new HttpError(400, "请先确认已核对收款或获准免费开通");
      if (current.priceCents > 0 && !input.paymentReference.trim())
        throw new HttpError(400, "付费订单必须填写收款凭据或交易流水号");
      if (
        current.priceCents > 0 &&
        (await tx.subscriptionOrder.findFirst({
          where: {
            status: "CONFIRMED",
            priceCents: { gt: 0 },
            paymentReference: input.paymentReference.trim(),
            id: { not: id },
          },
          select: { id: true },
        }))
      )
        throw new HttpError(409, "该收款凭据已用于另一笔订单，请核对后再处理");
      if (tenant.status !== "ACTIVE")
        throw new HttpError(400, "商家尚未开通或已停用，请先在商家管理中处理");
      const conflict = quotaConflict(
        current,
        await getTenantUsage(tenant.id, tx),
      );
      if (conflict)
        throw new HttpError(
          400,
          `${conflict}，暂不能开通，请先处理用量或重新下单`,
        );
      const period = renewalPeriod(tenant.expiresAt, current.durationDays, now);
      periodStart = period.start;
      periodEnd = period.end;
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          planName: current.planName,
          features: readFeatures(current.features),
          managementVersion: { increment: 1 },
          expiresAt: periodEnd,
          ...quotaFields(current),
        },
      });
    }
    if (input.decision === "REJECTED" && !input.note.trim())
      throw new HttpError(400, "请填写拒绝原因，方便商家处理");
    const order = await tx.subscriptionOrder.update({
      where: { id },
      data: {
        status: input.decision,
        reviewedAt: now,
        reviewedById: user.id,
        reviewedByName: user.name,
        reviewNote: input.note,
        paymentReference:
          input.decision === "CONFIRMED" ? input.paymentReference.trim() : "",
        periodStart,
        periodEnd,
      },
    });
    await audit(
      tx,
      user,
      order,
      `subscription.order.${input.decision.toLowerCase()}`,
    );
    if (input.decision !== "CANCELLED") {
      const recipients = await tx.user.findMany({
        where: {
          tenantId: order.tenantId,
          role: "MERCHANT_ADMIN",
          active: true,
        },
        select: { id: true },
      });
      await tx.accountNotice.createMany({
        data: recipients.map((recipient) => ({
          tenantId: order.tenantId,
          userId: recipient.id,
          kind: "subscription.order_update",
          dedupeKey: `order:${order.id}:${order.status}`,
          title:
            input.decision === "CONFIRMED"
              ? "套餐订单已开通"
              : "套餐订单未通过审核",
          body: `订单 ${order.orderNo}（${order.planName}）${input.decision === "CONFIRMED" ? "已确认开通，请在套餐与续费中查看有效期和额度。" : "已被拒绝。"}${order.reviewNote ? `平台说明：${order.reviewNote}` : ""}`,
        })),
        skipDuplicates: true,
      });
    }
    return { order, changed: true };
  });
}

export function serializeSubscriptionOrder(
  order: SubscriptionOrder & { tenant: { name: string } },
  includePaymentReference = false,
): OrderView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    tenantName: order.tenant.name,
    status: effectiveOrderStatus(order),
    planName: order.planName,
    features: readFeatures(order.features),
    priceCents: order.priceCents,
    durationDays: order.durationDays,
    ...quotaFields(order),
    merchantNote: order.merchantNote,
    reviewNote: order.reviewNote,
    requestedByName: order.requestedByName,
    reviewedByName: order.reviewedByName,
    paymentReportedAt: order.paymentReportedAt?.toISOString() ?? null,
    paymentNote: order.paymentNote,
    paymentReportVersion: order.paymentReportVersion,
    ...(includePaymentReference
      ? { paymentReference: order.paymentReference }
      : {}),
    createdAt: order.createdAt.toISOString(),
    validUntil: order.validUntil.toISOString(),
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    periodStart: order.periodStart?.toISOString() ?? null,
    periodEnd: order.periodEnd?.toISOString() ?? null,
  };
}
