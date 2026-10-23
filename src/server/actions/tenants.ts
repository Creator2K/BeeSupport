"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  HttpError,
  hashPassword,
  requireAdmin,
  requirePlatformAdmin,
} from "@/lib/auth";
import {
  tenantManagementSchema,
  type TenantInput,
} from "@/lib/tenant-management";
import { saveManagedTenant } from "@/server/services/tenant-management";
import { BASIC_FEATURES } from "@/lib/entitlements";
import { widgetSettingsSchema } from "@/lib/branding";
import { recordAudit } from "@/lib/audit";
import { ADMIN_PATH } from "@/lib/app-paths";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { emailSchema, passwordSchema, siteSlugSchema } from "@/lib/validation";
import { getIo, revokeAgentConnections } from "@/lib/realtime/emit";
import { toActionResult } from "./result";
import {
  getAccountPolicy,
  issueVerification,
} from "@/server/services/account-access";
import { getSmtpConfig } from "@/lib/mail";

const ownerSchema = z.object({
  ownerName: z.string().trim().min(1).max(40),
  ownerEmail: emailSchema,
  ownerPassword: passwordSchema,
});
export type { TenantInput } from "@/lib/tenant-management";
export type TenantOwnerInput = z.input<typeof ownerSchema>;

export async function saveTenantAction(
  input: TenantInput,
  id?: string,
  owner?: TenantOwnerInput,
  expectedVersion?: number,
) {
  try {
    const admin = await requirePlatformAdmin();
    const data = tenantManagementSchema.parse(input);
    const parsedOwner = id ? null : ownerSchema.parse(owner);
    const passwordHash = parsedOwner
      ? await hashPassword(parsedOwner.ownerPassword)
      : null;
    const tenant = await saveManagedTenant(
      admin,
      data,
      id,
      parsedOwner
        ? {
            name: parsedOwner.ownerName,
            email: parsedOwner.ownerEmail,
            passwordHash: passwordHash!,
          }
        : undefined,
      expectedVersion,
    );
    // A status change immediately revokes staff and visitor sockets across instances.
    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id, role: { not: "ADMIN" } },
      select: { id: true },
    });
    if (tenant.status !== "ACTIVE")
      for (const user of users) revokeAgentConnections(user.id);
    const sites = await prisma.site.findMany({
      where: { tenantId: tenant.id },
      select: { id: true },
    });
    const siteIds = new Set(sites.map((site) => site.id));
    if (
      tenant.status !== "ACTIVE" ||
      (tenant.expiresAt && tenant.expiresAt <= new Date())
    ) {
      for (const socket of (await getIo()?.fetchSockets()) ?? []) {
        if (siteIds.has(socket.data.identity?.visitor?.siteId))
          socket.disconnect(true);
      }
    }
    revalidatePath("/admin", "layout");
    if (ADMIN_PATH !== "/admin") revalidatePath(ADMIN_PATH, "layout");
    return {
      ok: true as const,
      message: id ? "商家及套餐已更新" : "商家已创建，可使用管理员邮箱登录",
      id: tenant.id,
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function saveBrandingAction(input: unknown, platform = false) {
  try {
    const admin = platform
      ? await requirePlatformAdmin()
      : await requireAdmin();
    const data = widgetSettingsSchema.parse(input);
    if (platform)
      await prisma.setting.upsert({
        where: { key: "platform.brand" },
        create: { key: "platform.brand", value: data },
        update: { value: data },
      });
    else
      await prisma.tenant.update({
        where: { id: admin.tenantId },
        data: { defaults: data },
      });
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: platform ? "platform.brand.update" : "tenant.brand.update",
      targetType: platform ? "Setting" : "Tenant",
      targetId: platform ? "platform.brand" : admin.tenantId,
    });
    revalidatePath("/admin", "layout");
    if (ADMIN_PATH !== "/admin") revalidatePath(ADMIN_PATH, "layout");
    return {
      ok: true as const,
      message: "默认配置已保存，继承此配置的站点会在访客重新打开时生效",
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function registerMerchantAction(
  input: { name: string; slug: string } & TenantOwnerInput,
) {
  try {
    const requestHeaders = await headers();
    if (
      !(
        await rateLimit(
          `merchant:register:${clientIp(requestHeaders)}`,
          5,
          3600,
        )
      ).ok
    )
      throw new HttpError(429, "申请过于频繁，请稍后再试");
    const data = ownerSchema
      .extend({ name: z.string().trim().min(1).max(80), slug: siteSlugSchema })
      .parse(input);
    const passwordHash = await hashPassword(data.ownerPassword);
    const policy = await getAccountPolicy();
    if (policy.requireEmailVerification && !(await getSmtpConfig()))
      throw new HttpError(503, "邮箱验证服务暂不可用，请联系平台管理员");
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          status: "PENDING",
          features: BASIC_FEATURES,
          contactEmail: data.ownerEmail,
          users: {
            create: {
              name: data.ownerName,
              email: data.ownerEmail,
              passwordHash,
              role: "MERCHANT_ADMIN",
              emailVerificationRequired: policy.requireEmailVerification,
            },
          },
        },
        include: { users: true },
      });
      if (policy.requireEmailVerification)
        await issueVerification(tx, created.users[0]);
      return created;
    });
    await recordAudit({
      action: "tenant.apply",
      targetType: "Tenant",
      targetId: tenant.id,
      ip: clientIp(requestHeaders),
      meta: { name: tenant.name },
    });
    revalidatePath(`${ADMIN_PATH}/merchants`);
    return {
      ok: true as const,
      message: policy.requireEmailVerification
        ? "申请已提交，请查收验证邮件并验证邮箱，平台审核开通后即可登录"
        : "申请已提交，请等待平台审核开通后再登录",
    };
  } catch (error) {
    return toActionResult(error);
  }
}
