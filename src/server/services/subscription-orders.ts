import { randomBytes } from "node:crypto";

import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { paymentReportSchema } from "../../lib/collection";
import { readFeatures } from "../../lib/entitlements";
import { quotaConflict } from "../../lib/subscriptions";
import { getTenantUsage } from "./tenants";
import { audit, manager, quotaFields } from "./subscription-access";

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
