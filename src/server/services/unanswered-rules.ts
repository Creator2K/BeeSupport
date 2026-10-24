import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  unansweredRuleSchema,
  type UnansweredRuleInput,
  type UnansweredRuleDetails,
} from "../../lib/unanswered";
import { ownerScope, siteScope } from "./unanswered-scope";

function ruleValue(
  rule: {
    enabled: boolean;
    ownerId: string | null;
    recipientMode: string;
    delayMinutes: number;
    version: number;
  } | null,
) {
  return {
    enabled: rule?.enabled ?? false,
    ownerId: rule?.ownerId ?? "",
    recipientMode: (rule?.recipientMode ??
      "ASSIGNED_OR_OWNER") as UnansweredRuleInput["recipientMode"],
    delayMinutes: rule?.delayMinutes ?? 10,
    version: rule?.version ?? 0,
  };
}
export async function getUnansweredRule(
  actor: SessionUser,
  siteId: string,
): Promise<UnansweredRuleDetails> {
  const where = siteScope(actor, siteId);
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: { id: true, tenantId: true, unansweredRule: true },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    const owners = await tx.user.findMany({
      where: ownerScope(site.tenantId, site.id),
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { rule: ruleValue(site.unansweredRule), owners };
  });
}
export async function saveUnansweredRule(
  actor: SessionUser,
  siteId: string,
  input: UnansweredRuleInput,
  now = new Date(),
) {
  const where = siteScope(actor, siteId),
    data = unansweredRuleSchema.parse(input);
  if (!(await rateLimit(`unanswered-rule:${actor.id}`, 30, 60)).ok)
    throw new HttpError(429, "操作过于频繁，请稍后重试");
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: { id: true, tenantId: true },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    await tx.$queryRaw`SELECT id FROM "Site" WHERE id = ${site.id} FOR UPDATE`;
    const current = await tx.unansweredRule.findUnique({ where: { siteId } });
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new HttpError(409, "配置已被其他管理员更新，请重新加载后再操作");
    const owner = data.ownerId
      ? await tx.user.findFirst({
          where: {
            AND: [ownerScope(site.tenantId, site.id), { id: data.ownerId }],
          },
          select: { id: true },
        })
      : null;
    if (data.enabled && !owner)
      throw new HttpError(400, "负责人须为本商家启用且有该站点权限的成员");
    const values = {
      enabled: data.enabled,
      ownerId: owner?.id ?? null,
      recipientMode: data.recipientMode,
      delayMinutes: data.delayMinutes,
      enabledAt:
        data.enabled && !current?.enabled ? now : (current?.enabledAt ?? null),
    };
    const rule = current
      ? await tx.unansweredRule.update({
          where: { id: current.id, version: data.expectedVersion },
          data: { ...values, version: { increment: 1 } },
        })
      : await tx.unansweredRule.create({ data: { siteId, ...values } });
    if (!data.enabled)
      await tx.unansweredReminder.updateMany({
        where: { ruleId: rule.id, resolvedAt: null },
        data: { resolvedAt: now, resolution: "DISABLED" },
      });
    await tx.auditLog.create({
      data: {
        tenantId: site.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "unanswered.rule.update",
        targetType: "UnansweredRule",
        targetId: rule.id,
        meta: { siteId, ...ruleValue(rule) },
      },
    });
    return ruleValue(rule);
  });
}
