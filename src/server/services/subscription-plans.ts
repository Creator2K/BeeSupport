import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  planInputSchema,
  type PlanInput,
} from "../../lib/subscriptions";
import { platform } from "./subscription-access";

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
