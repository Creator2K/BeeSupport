import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { getSmtpConfig } from "../../lib/mail";
import { rateLimit } from "../../lib/rate-limit";
import {
  accountTokenHash,
  newAccountToken,
} from "../../lib/account-links";
import { assertTenantQuota } from "./tenants";
import { queueAccountMail } from "./account-credentials";
import {
  assertInviteAdmin,
  invitationSchema,
  type InvitationInput,
} from "./account-invitation-schema";

export async function createInvitation(
  actor: SessionUser,
  input: InvitationInput,
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
