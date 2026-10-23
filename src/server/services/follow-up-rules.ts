import type { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  followUpRuleSchema,
  type FollowUpRuleInput,
  type FollowUpRuleDetails,
} from "../../lib/follow-up-rules";

function siteScope(actor: SessionUser, siteId: string): Prisma.SiteWhereInput {
  if (!actor.tenantId || !["ADMIN", "MERCHANT_ADMIN"].includes(actor.role))
    throw new HttpError(403, "需要管理员权限");
  return {
    id: siteId,
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(actor.siteIds === null ? {} : { AND: [{ id: { in: actor.siteIds } }] }),
  };
}

function eligibleOwner(
  tenantId: string,
  siteId: string,
): Prisma.UserWhereInput {
  return {
    tenantId,
    active: true,
    OR: [
      { role: { in: ["ADMIN", "MERCHANT_ADMIN"] } },
      { role: "AGENT", sites: { some: { siteId } } },
    ],
  };
}

export async function getFollowUpRule(
  actor: SessionUser,
  siteId: string,
): Promise<FollowUpRuleDetails> {
  const where = siteScope(actor, siteId);
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: {
        id: true,
        name: true,
        tenantId: true,
        active: true,
        followUpRule: true,
      },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    const owners = await tx.user.findMany({
      where: eligibleOwner(site.tenantId, site.id),
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return {
      site: { id: site.id, name: site.name, active: site.active },
      owners,
      rule: {
        enabled: site.followUpRule?.enabled ?? false,
        ownerId: site.followUpRule?.ownerId ?? "",
        delayMinutes: site.followUpRule?.delayMinutes ?? 60,
        version: site.followUpRule?.version ?? 0,
      },
      ownerAvailable: owners.some(
        (owner) => owner.id === site.followUpRule?.ownerId,
      ),
    };
  });
}

export async function saveFollowUpRule(
  actor: SessionUser,
  siteId: string,
  input: FollowUpRuleInput,
) {
  const where = siteScope(actor, siteId),
    data = followUpRuleSchema.parse(input);
  if (!(await rateLimit(`followup-rule:${actor.id}`, 30, 60)).ok)
    throw new HttpError(429, "操作过于频繁，请稍后重试");
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where,
      select: { id: true, tenantId: true },
    });
    if (!site) throw new HttpError(404, "站点不存在或无权访问");
    // Serializes first creation and subsequent CAS updates for one site's rule.
    await tx.$queryRaw`SELECT id FROM "Site" WHERE id = ${site.id} FOR UPDATE`;
    const current = await tx.followUpRule.findUnique({ where: { siteId } });
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new HttpError(409, "配置已被其他管理员更新，请重新加载后再操作");
    const owner = data.ownerId
      ? await tx.user.findFirst({
          where: {
            AND: [eligibleOwner(site.tenantId, site.id), { id: data.ownerId }],
          },
          select: { id: true },
        })
      : null;
    if (data.enabled && !owner)
      throw new HttpError(400, "负责人须为本商家启用且有该站点权限的成员");
    const values = {
      enabled: data.enabled,
      ownerId: owner?.id ?? null,
      delayMinutes: data.delayMinutes,
    };
    const rule = current
      ? await tx.followUpRule.update({
          where: { id: current.id, version: data.expectedVersion },
          data: { ...values, version: { increment: 1 } },
        })
      : await tx.followUpRule.create({ data: { siteId, ...values } });
    await tx.auditLog.create({
      data: {
        tenantId: site.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "followup.rule.update",
        targetType: "FollowUpRule",
        targetId: rule.id,
        meta: {
          siteId,
          enabled: rule.enabled,
          ownerId: rule.ownerId,
          delayMinutes: rule.delayMinutes,
          version: rule.version,
        },
      },
    });
    return {
      enabled: rule.enabled,
      ownerId: rule.ownerId ?? "",
      delayMinutes: rule.delayMinutes,
      version: rule.version,
    };
  });
}

/** Called only for a newly created offline conversation, inside its creation transaction. */
export async function createOfflineFollowUp(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
  const conversation = await tx.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      source: true,
      createdAt: true,
      siteId: true,
      site: {
        select: {
          tenantId: true,
          active: true,
          tenant: { select: { status: true, expiresAt: true } },
          followUpRule: true,
        },
      },
    },
  });
  const rule = conversation?.site.followUpRule,
    now = new Date();
  if (
    !conversation ||
    conversation.source !== "OFFLINE_FORM" ||
    !conversation.site.active ||
    conversation.site.tenant.status !== "ACTIVE" ||
    (conversation.site.tenant.expiresAt &&
      conversation.site.tenant.expiresAt <= now) ||
    !rule?.enabled ||
    !rule.ownerId
  )
    return false;
  const owner = await tx.user.findFirst({
    where: {
      AND: [
        eligibleOwner(conversation.site.tenantId, conversation.siteId),
        { id: rule.ownerId },
      ],
    },
    select: { id: true },
  });
  // Never silently transfer responsibility if the configured member was removed or disabled.
  if (!owner) return false;
  const created = await tx.followUp.createMany({
    data: {
      tenantId: conversation.site.tenantId,
      conversationId,
      ownerId: owner.id,
      note: "离线留言自动跟进：请联系访客并处理咨询。",
      dueAt: new Date(
        conversation.createdAt.getTime() + rule.delayMinutes * 60000,
      ),
    },
    skipDuplicates: true,
  });
  if (!created.count) return false;
  const task = await tx.followUp.findUniqueOrThrow({
    where: { conversationId },
    select: { id: true, dueAt: true },
  });
  await tx.auditLog.create({
    data: {
      tenantId: conversation.site.tenantId,
      actorName: "系统",
      action: "followup.autoCreate",
      targetType: "FollowUp",
      targetId: task.id,
      meta: {
        conversationId,
        ownerId: owner.id,
        dueAt: task.dueAt.toISOString(),
        ruleId: rule.id,
        ruleVersion: rule.version,
      },
    },
  });
  return true;
}
