import { requirePlatformPage } from "@/lib/platform-page";
import { prisma } from "@/lib/db";
import { defaultWidgetSettings, parseWidgetSettings } from "@/lib/branding";
import { PageHeader } from "@/components/admin/page-header";
import { BrandSettings } from "@/components/admin/brand-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "平台默认配置" };
export default async function PlatformBrandingPage() {
  await requirePlatformPage();
  const setting = await prisma.setting.findUnique({
    where: { key: "platform.brand" },
  });
  return (
    <div>
      <PageHeader
        title="平台默认配置"
        description="提供所有商家的初始品牌与功能配置，商家和站点可以分别覆盖。"
      />
      <BrandSettings
        platform
        initial={parseWidgetSettings(setting?.value)}
        inherited={defaultWidgetSettings}
      />
    </div>
  );
}
