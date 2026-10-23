import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformPage } from "@/lib/platform-page";
import { prisma } from "@/lib/db";
import { PlansClient } from "./plans-client";
import { readFeatures } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export const metadata = { title: "套餐管理" };
export default async function PlansPage() {
  await requirePlatformPage();
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div>
      <PageHeader
        title="套餐管理"
        description="维护商家可选套餐。价格单位为人民币；下架只阻止新订单，已提交的有效订单仍使用原报价。"
      />
      <PlansClient
        plans={plans.map(({ createdAt: _createdAt, ...plan }) => ({
          ...plan,
          features: readFeatures(plan.features),
          updatedAt: plan.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
