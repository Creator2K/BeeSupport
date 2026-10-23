import { prisma } from "../../lib/db";
import { HttpError } from "../../lib/auth";
import { readFeatures, type TenantFeatures } from "../../lib/entitlements";
export async function getTenantFeatures(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { features: true },
  });
  return readFeatures(tenant.features);
}
export async function getSiteFeatures(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    select: { tenant: { select: { features: true } } },
  });
  return readFeatures(site.tenant.features);
}
export async function assertTenantFeature(
  tenantId: string,
  feature: keyof TenantFeatures,
) {
  if (!(await getTenantFeatures(tenantId))[feature])
    throw new HttpError(403, "当前套餐未开通此功能，请联系平台调整套餐");
}
