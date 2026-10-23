import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/auth";
import { mergeWidgetSettings, parseWidgetSettings } from "@/lib/branding";
import { getPlatformBranding } from "@/server/services/tenants";
import { env } from "@/lib/env";
import { getServerT } from "@/lib/i18n/server";
import { adminDb } from "@/lib/tenant-db";

import { SitesClient } from "./sites-client";
import { readFeatures } from "@/lib/entitlements";

export const metadata = { title: "站点管理" };

export default async function SitesPage() {
  const prisma = await adminDb();
  const admin = await requireAdmin();
  const platform = await getPlatformBranding();
  const ownTenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: admin.tenantId },
    select: { defaults: true, features: true },
  });
  const { t } = await getServerT();

  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      tenant: { select: { defaults: true, features: true } },
      _count: { select: { conversations: true, visitors: true, agents: true } },
      agents: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  const data = sites.map((site) => ({
    id: site.id,
    canCustomizeFooter: readFeatures(site.tenant.features).removeBranding,
    widgetSettings: parseWidgetSettings(site.widgetSettings),
    inheritedSettings: mergeWidgetSettings(
      { primaryColor: site.primaryColor, position: site.position },
      platform,
      site.tenant.defaults,
      ...(readFeatures(site.tenant.features).removeBranding
        ? []
        : [
            {
              footerText:
                mergeWidgetSettings(platform).footerText.trim() ||
                "Powered by BeeSupport",
            },
          ]),
    ),
    name: site.name,
    slug: site.slug,
    publicKey: site.publicKey,
    description: site.description,
    primaryColor: site.primaryColor,
    position: site.position,
    welcomeMessage: site.welcomeMessage,
    offlineMessage: site.offlineMessage,
    requireEmail: site.requireEmail,
    autoAssign: site.autoAssign,
    imageReviewEnabled: site.imageReviewEnabled,
    notifyEmail: site.notifyEmail,
    allowedOrigins: site.allowedOrigins,
    workHours: site.workHours,
    active: site.active,
    counts: {
      conversations: site._count.conversations,
      visitors: site._count.visitors,
      agents: site._count.agents,
    },
    agentNames: site.agents.map((item) => item.user.name),
  }));

  return (
    <div>
      <PageHeader title={t("nav.sites")} description={t("sites.subtitle")} />
      <SitesClient
        sites={data}
        canCustomizeFooter={readFeatures(ownTenant.features).removeBranding}
        appUrl={env.APP_URL}
        defaultSettings={mergeWidgetSettings(
          platform,
          ownTenant.defaults,
          ...(readFeatures(ownTenant.features).removeBranding
            ? []
            : [
                {
                  footerText:
                    mergeWidgetSettings(platform).footerText.trim() ||
                    "Powered by BeeSupport",
                },
              ]),
        )}
      />
    </div>
  );
}
