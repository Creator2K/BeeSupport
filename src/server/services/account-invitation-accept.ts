import { z } from "zod";

import { HttpError, hashPassword } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { passwordSchema } from "../../lib/validation";
import { assertTenantQuota } from "./tenants";
import {
  assertLive,
  claimToken,
  findToken,
  invalidLink,
} from "./account-tokens";

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
