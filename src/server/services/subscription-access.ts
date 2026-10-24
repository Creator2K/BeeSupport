import type { Prisma, SubscriptionOrder } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import type { PlanInput } from "../../lib/subscriptions";

export function manager(user: SessionUser) {
  if (user.role !== "ADMIN" && user.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "需要商家管理员权限");
}
export function platform(user: SessionUser) {
  if (user.role !== "ADMIN") throw new HttpError(403, "需要平台管理员权限");
}
export const quotaFields = (
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
export async function audit(
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
