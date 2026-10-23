import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ADMIN_PATH } from "@/lib/app-paths";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mergeWidgetSettings, parseWidgetSettings } from "@/lib/branding";
import { getTenantUsage } from "@/server/services/tenants";
import { PageHeader, StatCard } from "@/components/admin/page-header";
import { BrandSettings } from "@/components/admin/brand-settings";
import { readFeatures } from "@/lib/entitlements";
import { FeatureSummary } from "@/components/admin/feature-summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "商家配置与用量" };
export default async function OrganizationPage() {
  const admin = await requireAdmin();
  const [tenant, platform, usage] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: admin.tenantId },
      select: {
        name: true,
        planName: true,
        expiresAt: true,
        defaults: true,
        features: true,
        maxAgents: true,
        maxSites: true,
        monthlyConversations: true,
        storageMB: true,
      },
    }),
    prisma.setting.findUnique({ where: { key: "platform.brand" } }),
    getTenantUsage(admin.tenantId),
  ]);
  const notices: string[] = [];
  if (
    tenant.expiresAt &&
    tenant.expiresAt > new Date() &&
    tenant.expiresAt.getTime() - Date.now() <= 7 * 86400000
  )
    notices.push("服务将在 7 天内到期，建议提前提交续费订单。");
  for (const [label, used, limit] of [
    ["启用账号", usage.agents, tenant.maxAgents],
    ["站点", usage.sites, tenant.maxSites],
    ["本月会话", usage.conversations, tenant.monthlyConversations],
    ["存储空间", usage.storageBytes, tenant.storageMB * 1048576],
  ] as const)
    if (used / limit >= 0.8)
      notices.push(
        `${label}已使用 ${Math.round((used / limit) * 100)}%，可调整套餐额度。`,
      );
  return (
    <div className="space-y-6">
      <PageHeader
        title="商家配置与用量"
        description={`${tenant.name} · ${tenant.planName} · ${tenant.expiresAt ? `有效期至 ${tenant.expiresAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）` : "长期有效"}`}
      />
      {admin.tenantExpired && (
        <p
          role="status"
          className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
        >
          服务已到期，访客接待已暂停，历史记录保留。请联系平台管理员续期。
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
        <Button asChild size="sm">
          <Link href={`${ADMIN_PATH}/subscription`}>套餐与续费</Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="启用账号（含商家管理员）"
          value={`${usage.agents} / ${tenant.maxAgents}`}
        />
        <StatCard
          label="站点（含停用站点）"
          value={`${usage.sites} / ${tenant.maxSites}`}
        />
        <StatCard
          label="本月新会话（北京时间）"
          value={`${usage.conversations} / ${tenant.monthlyConversations}`}
        />
        <StatCard
          label="存储空间 MB"
          value={`${(usage.storageBytes / 1048576).toFixed(1)} / ${tenant.storageMB}`}
        />
      </div>
      <section className="space-y-3 rounded-xl border p-4 sm:p-6">
        <h2 className="font-medium">当前套餐功能</h2>
        <FeatureSummary features={tenant.features} />
      </section>
      <section className="rounded-xl border p-4 sm:p-6">
        <h2 className="mb-4 font-medium">商家默认品牌与聊天功能</h2>
        <BrandSettings
          canCustomizeFooter={readFeatures(tenant.features).removeBranding}
          initial={parseWidgetSettings(tenant.defaults)}
          inherited={{
            ...mergeWidgetSettings(platform?.value),
            footerText:
              mergeWidgetSettings(platform?.value).footerText.trim() ||
              "Powered by BeeSupport",
          }}
        />
      </section>
    </div>
  );
}
