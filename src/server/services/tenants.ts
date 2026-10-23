import type { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { env } from "../../lib/env";
import { prisma } from "../../lib/db";
import { mergeWidgetSettings } from "../../lib/branding";
import { readFeatures } from "../../lib/entitlements";

/** Platform edits of another merchant's site must retain that merchant's ownership. */
export async function resourceTenantId(
  user: SessionUser,
  siteId?: string | null,
  existingTenantId?: string,
) {
  if (siteId) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { tenantId: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");
    if (user.role !== "ADMIN" && site.tenantId !== user.tenantId)
      throw new HttpError(403, "无权访问该站点");
    return site.tenantId;
  }
  if (
    existingTenantId &&
    user.role !== "ADMIN" &&
    existingTenantId !== user.tenantId
  )
    throw new HttpError(403, "无权访问该商家");
  return existingTenantId ?? user.tenantId;
}

export function tenantCanServe(tenant: {
  status: string;
  expiresAt: Date | null;
}): boolean {
  return (
    tenant.status === "ACTIVE" &&
    (!tenant.expiresAt || tenant.expiresAt > new Date())
  );
}

export async function getPlatformBranding() {
  return (
    (await prisma.setting.findUnique({ where: { key: "platform.brand" } }))
      ?.value ?? {}
  );
}

export async function getWidgetSettings(
  siteId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const [site, platform] = await Promise.all([
    db.site.findUnique({
      where: { id: siteId },
      select: {
        widgetSettings: true,
        primaryColor: true,
        position: true,
        tenant: { select: { defaults: true, features: true } },
      },
    }),
    db.setting.findUnique({ where: { key: "platform.brand" } }),
  ]);
  if (!site) throw new HttpError(404, "站点不存在");
  const settings = mergeWidgetSettings(
    { primaryColor: site.primaryColor, position: site.position },
    platform?.value,
    site.tenant.defaults,
    site.widgetSettings,
  );
  return {
    ...settings,
    footerText: readFeatures(site.tenant.features).removeBranding
      ? settings.footerText
      : mergeWidgetSettings(platform?.value).footerText.trim() ||
        "Powered by BeeSupport",
    maxUploadMB: Math.min(settings.maxUploadMB, env.UPLOAD_MAX_BYTES / 1048576),
  };
}

export function monthStart(now = new Date()): Date {
  const local = new Date(now.getTime() + 8 * 3600000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 8 * 3600000,
  );
}

export async function getTenantUsage(
  tenantId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const [agents, sites, conversations, storage] = await Promise.all([
    db.user.count({
      where: { tenantId, role: { not: "ADMIN" }, active: true },
    }),
    db.site.count({ where: { tenantId } }),
    db.conversation.count({
      where: { site: { tenantId }, createdAt: { gte: monthStart() } },
    }),
    db.attachment.aggregate({
      where: { site: { tenantId } },
      _sum: { size: true },
    }),
  ]);
  return { agents, sites, conversations, storageBytes: storage._sum.size ?? 0 };
}

/** Every quota-consuming writer locks the same tenant row, including concurrent requests. */
export async function assertTenantQuota(
  db: Prisma.TransactionClient,
  tenantId: string,
  kind: "sites" | "agents" | "conversations" | "storage",
  bytes = 0,
) {
  const tenant = await db.tenant.update({
    where: { id: tenantId },
    data: { updatedAt: new Date() },
  });
  if (!tenantCanServe(tenant))
    throw new HttpError(
      403,
      "商家服务未开通、已停用或已到期，请联系平台管理员",
    );
  const used =
    kind === "sites"
      ? await db.site.count({ where: { tenantId } })
      : kind === "agents"
        ? await db.user.count({
            where: { tenantId, active: true, role: { not: "ADMIN" } },
          })
        : kind === "conversations"
          ? await db.conversation.count({
              where: { site: { tenantId }, createdAt: { gte: monthStart() } },
            })
          : ((
              await db.attachment.aggregate({
                where: { site: { tenantId } },
                _sum: { size: true },
              })
            )._sum.size ?? 0);
  const limit =
    kind === "sites"
      ? tenant.maxSites
      : kind === "agents"
        ? tenant.maxAgents
        : kind === "conversations"
          ? tenant.monthlyConversations
          : tenant.storageMB * 1024 * 1024;
  if (kind === "storage" ? used + bytes > limit : used >= limit)
    throw new HttpError(
      403,
      `${{ sites: "站点数量", agents: "启用账号数", conversations: "本月会话数", storage: "存储空间" }[kind]}已达套餐上限，请联系平台管理员调整套餐`,
    );
  return tenant;
}

export async function assertSiteServing(
  siteId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { active: true, tenant: true },
  });
  if (!site?.active || !tenantCanServe(site.tenant))
    throw new HttpError(403, "该站点当前暂停服务，请联系商家");
  return site.tenant;
}

export async function assertVisitorUploadAllowed(siteId: string, file: File) {
  const settings = await getWidgetSettings(siteId);
  const image = file.type.toLowerCase().startsWith("image/");
  if (image ? !settings.imagesEnabled : !settings.filesEnabled)
    throw new HttpError(
      403,
      image ? "此站点已关闭图片发送" : "此站点已关闭文件发送",
    );
  if (file.size > settings.maxUploadMB * 1024 * 1024)
    throw new HttpError(400, `文件大小不能超过 ${settings.maxUploadMB} MB`);
}
