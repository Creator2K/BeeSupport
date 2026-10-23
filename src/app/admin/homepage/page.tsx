import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformPage } from "@/lib/platform-page";
import { prisma } from "@/lib/db";
import { getHomeEditor } from "@/server/services/homepage";
import { HomeEditor } from "./home-editor";
export const dynamic = "force-dynamic";
export const metadata = { title: "首页运营配置" };
export default async function Page() {
  await requirePlatformPage();
  const [editor, plans] = await Promise.all([
    getHomeEditor(),
    prisma.subscriptionPlan.findMany({
      where: { active: true },
      select: { id: true, name: true, priceCents: true, durationDays: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="首页运营配置"
        description="编辑品牌、首页文案、常见问题与展示套餐。保存草稿不会改变公开首页，确认预览后再发布。"
      />
      <HomeEditor initial={editor} plans={plans} />
    </div>
  );
}
