import { z } from "zod";

import { HttpError, hashPassword, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { getSmtpConfig } from "../../lib/mail";
import { rateLimit } from "../../lib/rate-limit";
import { emailSchema, passwordSchema } from "../../lib/validation";
import {
  accountTokenHash,
  newAccountToken,
} from "../../lib/account-links";
import { assertTenantQuota } from "./tenants";
import { queueAccountMail } from "./account-credentials";
import {
  assertLive,
  claimToken,
  findToken,
  invalidLink,
} from "./account-tokens";

export const invitationSchema = z.object({
  email: emailSchema,
  role: z.enum(["AGENT", "MERCHANT_ADMIN"]).default("AGENT"),
  siteIds: z.array(z.string().min(1)).max(200).default([]),
});

function assertInviteAdmin(actor: SessionUser) {
  if (actor.role !== "ADMIN" && actor.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "需要管理员权限");
}

export async function listInvitations(actor: SessionUser) {
  assertInviteAdmin(actor);
  const rows = await prisma.accountToken.findMany({
    where: {
      tenantId: actor.tenantId,
      purpose: "INVITE",
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      role: true,
      siteIds: true,
      expiresAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function createInvitation(
  actor: SessionUser,
  input: z.input<typeof invitationSchema>,
  resendId?: string,
) {
  assertInviteAdmin(actor);
  const data = invitationSchema.parse(input);
  if (!(await getSmtpConfig()))
    throw new HttpError(
      400,
      "请先联系平台管理员配置 SMTP 邮件服务，也可继续手动创建账号",
    );
  if (
    !(await rateLimit(`invitation:issuer:${actor.id}`, 20, 3600)).ok ||
    !(
      await rateLimit(
        `invitation:email:${actor.tenantId}:${data.email}`,
        3,
        3600,
      )
    ).ok
  )
    throw new HttpError(429, "邀请过于频繁，请稍后重试");
  const raw = newAccountToken();
  return prisma.$transaction(async (tx) => {
    await assertTenantQuota(tx, actor.tenantId, "agents");
    const issuer = await tx.user.findFirst({
      where: {
        id: actor.id,
        tenantId: actor.tenantId,
        active: true,
        role: { in: ["ADMIN", "MERCHANT_ADMIN"] },
      },
    });
    if (!issuer) throw new HttpError(403, "邀请人权限已失效");
    if (await tx.user.findUnique({ where: { email: data.email } }))
      throw new HttpError(409, "该邮箱已有账号，请使用其他邮箱或管理已有账号");
    const siteIds = data.role === "AGENT" ? [...new Set(data.siteIds)] : [];
    if (
      (await tx.site.count({
        where: { id: { in: siteIds }, tenantId: actor.tenantId },
      })) !== siteIds.length
    )
      throw new HttpError(403, "邀请只能分配当前团队的站点");
    const pending = await tx.accountToken.findFirst({
      where: {
        tenantId: actor.tenantId,
        email: data.email,
        purpose: "INVITE",
        revokedAt: null,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (resendId) {
      if (pending && pending.id !== resendId)
        throw new HttpError(409, "邀请已更新，请刷新后重试");
      const previous = await tx.accountToken.findFirst({
        where: {
          id: resendId,
          tenantId: actor.tenantId,
          purpose: "INVITE",
          email: data.email,
          usedAt: null,
          revokedAt: null,
        },
      });
      if (!previous) throw new HttpError(404, "邀请不存在或已失效");
      await tx.accountToken.update({
        where: { id: previous.id },
        data: { revokedAt: new Date() },
      });
    } else if (pending)
      throw new HttpError(409, "该邮箱已有待接受邀请，可在下方重新发送或撤销");
    if (
      (await tx.accountToken.count({
        where: {
          tenantId: actor.tenantId,
          purpose: "INVITE",
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })) >= 100
    )
      throw new HttpError(400, "待接受邀请过多，请先撤销不再需要的邀请");
    const row = await tx.accountToken.create({
      data: {
        tenantId: actor.tenantId,
        inviterId: actor.id,
        purpose: "INVITE",
        email: data.email,
        role: data.role,
        siteIds,
        tokenHash: accountTokenHash(raw),
        expiresAt: new Date(Date.now() + 72 * 3600_000),
      },
    });
    await queueAccountMail(tx, row, raw);
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "team.invite.created",
        targetType: "AccountToken",
        targetId: row.id,
        meta: { email: data.email, role: data.role },
      },
    });
    return row.id;
  });
}

export async function revokeInvitation(actor: SessionUser, id: string) {
  assertInviteAdmin(actor);
  await prisma.$transaction(async (tx) => {
    // Match the same tenant lock/order as acceptance and quota-consuming writers.
    await tx.tenant.update({
      where: { id: actor.tenantId },
      data: { updatedAt: new Date() },
    });
    const changed = await tx.accountToken.updateMany({
      where: {
        id,
        tenantId: actor.tenantId,
        purpose: "INVITE",
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!changed.count) throw new HttpError(404, "邀请不存在或已失效");
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "team.invite.revoked",
        targetType: "AccountToken",
        targetId: id,
      },
    });
  });
}

export async function acceptInvitation(
  raw: string,
  name: string,
  password: string,
) {
  const row = await findToken(raw);
  assertLive(row, "INVITE");
  const parsedName = z.string().trim().min(1, "请输入姓名").max(40).parse(name);
  const passwordHash = await hashPassword(passwordSchema.parse(password));
  try {
    await prisma.$transaction(async (tx) => {
      await assertTenantQuota(tx, row.tenantId, "agents");
      const issuer = await tx.user.findFirst({
        where: {
          id: row.inviterId!,
          tenantId: row.tenantId,
          active: true,
          role: { in: ["ADMIN", "MERCHANT_ADMIN"] },
        },
      });
      if (!issuer)
        throw new HttpError(403, "邀请人权限已失效，请联系团队管理员重新邀请");
      if (row.role !== "AGENT" && row.role !== "MERCHANT_ADMIN")
        throw invalidLink();
      if (
        (await tx.site.count({
          where: { id: { in: row.siteIds }, tenantId: row.tenantId },
        })) !== row.siteIds.length
      )
        throw new HttpError(400, "邀请中的站点已变更，请联系管理员重新邀请");
      await claimToken(tx, row);
      const user = await tx.user.create({
        data: {
          tenantId: row.tenantId,
          email: row.email,
          name: parsedName,
          passwordHash,
          role: row.role,
          emailVerifiedAt: new Date(),
          sites:
            row.role === "AGENT"
              ? { create: row.siteIds.map((siteId: string) => ({ siteId })) }
              : undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: row.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: "team.invite.accepted",
          targetType: "AccountToken",
          targetId: row.id,
        },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new HttpError(409, "该邮箱已有账号，请直接登录或联系管理员");
    throw error;
  }
}
