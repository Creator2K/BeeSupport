import { requirePlatformPage } from "@/lib/platform-page";
import { PageHeader } from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { listMerchantDirectory } from "@/server/services/merchant-directory";
import { ADMIN_PATH } from "@/lib/app-paths";
import { MerchantsClient } from "./merchants-client";
import { readFeatures } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export const metadata = { title: "商家与套餐" };
export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePlatformPage();
  const params = await searchParams;
  const search =
    typeof params.search === "string" ? params.search.slice(0, 120) : "";
  const status =
    typeof params.status === "string" &&
    ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"].includes(params.status)
      ? params.status
      : "";
  const result = await listMerchantDirectory(admin, {
    search,
    status,
    page: Number(params.page),
  });
  const data = result.tenants.map((tenant) => ({
    id: tenant.id,
    managementVersion: tenant.managementVersion,
    features: readFeatures(tenant.features),
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status as "ACTIVE" | "PENDING" | "SUSPENDED",
    planName: tenant.planName,
    expiresAt: tenant.expiresAt?.toISOString() ?? null,
    maxAgents: tenant.maxAgents,
    maxSites: tenant.maxSites,
    monthlyConversations: tenant.monthlyConversations,
    storageMB: tenant.storageMB,
    contactEmail: tenant.contactEmail,
    note: tenant.note,
    usage: tenant.usage,
  }));
  return (
    <div>
      <PageHeader
        title="商家与套餐"
        description="审核入驻、人工开通及续期，管理各商家的服务状态与资源额度。用量月份按北京时间计算。"
      />
      <MerchantsClient tenants={data} search={search} status={status} />
      <ListPagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath={`${ADMIN_PATH}/merchants`}
        filters={{ search, status }}
      />
    </div>
  );
}
