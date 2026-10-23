import { PageHeader } from "@/components/admin/page-header";
import { WechatLoginPanel } from "@/components/admin/wechat-login-panel";
import { getServerT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { formatDateTime } from "@/lib/format";
import { getWechatConfig, getWechatState } from "@/server/services/wechatbot";

import { WebhooksClient } from "./webhooks-client";

export const metadata = { title: "通知渠道" };
export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const admin = await requireAdmin();
  const prisma = await adminDb();
  const { t, locale } = await getServerT();

  const [endpoints, sites, wechatState, wechatConfig] = await Promise.all([
    prisma.webhookEndpoint.findMany({
      orderBy: { createdAt: "asc" },
      include: { site: { select: { id: true, name: true } } },
    }),
    prisma.site.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    Promise.resolve(admin.role === "ADMIN" ? getWechatState() : null),
    admin.role === "ADMIN" ? getWechatConfig() : Promise.resolve(null),
  ]);

  const data = endpoints.map((endpoint) => ({
    id: endpoint.id,
    name: endpoint.name,
    type: endpoint.type,
    url: endpoint.url,
    secret: endpoint.secret,
    events: endpoint.events,
    siteId: endpoint.siteId,
    siteName: endpoint.site?.name ?? null,
    active: endpoint.active,
    lastStatus: endpoint.lastStatus,
    lastTriggeredAt: endpoint.lastTriggeredAt
      ? formatDateTime(endpoint.lastTriggeredAt, locale)
      : null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("webhooks.title")}
        description={t("webhooks.subtitle")}
      />

      {/* 微信渠道用的就是这台机器人，登录入口就放在渠道列表上方 */}
      {wechatState && wechatConfig && (
        <WechatLoginPanel
          initialState={wechatState}
          initialConfig={wechatConfig}
        />
      )}

      <WebhooksClient
        endpoints={data}
        sites={sites}
        platform={admin.role === "ADMIN"}
      />
    </div>
  );
}
