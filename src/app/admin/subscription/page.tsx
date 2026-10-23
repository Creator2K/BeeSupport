import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { SubscriptionCatalog } from "@/components/admin/subscription-catalog";
import { SubscriptionOrders } from "@/components/admin/subscription-orders";
import { ListPagination } from "@/components/admin/list-pagination";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getTenantUsage } from "@/server/services/tenants";
import { serializeSubscriptionOrder } from "@/server/services/subscriptions";
import { CollectionInfo } from "@/components/admin/collection-info";
import { getCollectionSettings } from "@/server/services/collection";
import { DEFAULT_COLLECTION } from "@/lib/collection";
import { readFeatures } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export const metadata = { title: "套餐与续费" };
export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const requested = Math.max(1, Math.min(100000, Number(params.page) || 1)) | 0;
  const where = { tenantId: admin.tenantId };
  const pageSize = 10;
  const [tenant, usage, plans, total, pending, collection] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: admin.tenantId },
      select: { name: true, planName: true, expiresAt: true },
    }),
    getTenantUsage(admin.tenantId),
    prisma.subscriptionPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.subscriptionOrder.count({ where }),
    prisma.subscriptionOrder.count({
      where: { ...where, status: "PENDING", validUntil: { gt: new Date() } },
    }),
    getCollectionSettings(),
  ]);
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  const orders = await prisma.subscriptionOrder.findMany({
    where,
    include: { tenant: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="套餐与续费"
        description={`${tenant.name} · 当前套餐：${tenant.planName} · ${tenant.expiresAt ? `有效期至 ${tenant.expiresAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）` : "长期有效"}`}
      />
      <p className="text-sm text-muted-foreground">
        采用人工核对收款、确认开通方式。
        <Link className="ml-2 underline" href={`${ADMIN_PATH}/organization`}>
          查看当前额度及用量
        </Link>
      </p>
      <CollectionInfo
        settings={
          collection.settings.enabled ? collection.settings : DEFAULT_COLLECTION
        }
      />
      <section className="space-y-4">
        <h2 className="font-semibold">可选套餐</h2>
        <SubscriptionCatalog
          plans={plans.map((plan) => ({
            ...plan,
            features: readFeatures(plan.features),
            updatedAt: plan.updatedAt.toISOString(),
          }))}
          usage={usage}
          pendingOrder={pending > 0}
          longTerm={!tenant.expiresAt}
        />
      </section>
      <section className="space-y-4">
        <h2 className="font-semibold">订单记录</h2>
        <SubscriptionOrders
          orders={orders.map((order) => serializeSubscriptionOrder(order))}
        />
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={total}
          basePath={`${ADMIN_PATH}/subscription`}
          filters={{}}
        />
      </section>
    </div>
  );
}
