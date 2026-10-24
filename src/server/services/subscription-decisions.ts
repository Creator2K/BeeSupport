import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { readFeatures } from "../../lib/entitlements";
import { quotaConflict, renewalPeriod } from "../../lib/subscriptions";
import { getTenantUsage } from "./tenants";
import {
  audit,
  manager,
  platform,
  quotaFields,
} from "./subscription-access";

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
