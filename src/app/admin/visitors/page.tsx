import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { VisitorInsights } from "@/components/admin/visitor-insights";
import { Button } from "@/components/ui/button";
import { ADMIN_PATH } from "@/lib/app-paths";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { getVisitorAnalytics } from "@/server/services/visitor-analytics";
import { getTenantFeatures } from "@/server/services/entitlements";

export const metadata = { title: "访客画像统计" };
export const dynamic = "force-dynamic";

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prisma = await adminDb();
  const admin = await requireAdmin();
  if (
    admin.role !== "ADMIN" &&
    !(await getTenantFeatures(admin.tenantId)).advancedAnalytics
  )
    return (
      <div className="space-y-4">
        <PageHeader
          title="访客画像"
          description="整体访客画像统计未包含在当前套餐中。"
        />
        <p className="text-sm text-muted-foreground">
          访客明细和日常接待可继续使用。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`${ADMIN_PATH}/subscription`}>查看可选套餐</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${ADMIN_PATH}/visitors/list`}>查看访客明细</Link>
          </Button>
        </div>
      </div>
    );
  const params = await searchParams;
  const siteId =
    typeof params.siteId === "string" ? params.siteId.slice(0, 128) : "";
  const days = [7, 30, 90].includes(Number(params.days))
    ? Number(params.days)
    : 30;
  const [data, sites] = await Promise.all([
    getVisitorAnalytics(
      siteId || undefined,
      days,
      new Date(),
      admin.role === "ADMIN" ? undefined : admin.tenantId,
    ),
    prisma.site.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return (
    <div className="min-w-0">
      <PageHeader
        title="访客画像"
        description="从整体了解访客构成、访问行为、来源渠道与咨询转化。"
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <form className="flex max-w-full flex-wrap gap-2">
          <select
            name="siteId"
            aria-label="筛选站点"
            defaultValue={siteId}
            className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">全部站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <select
            name="days"
            aria-label="新增趋势周期"
            defaultValue={days}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="7">近 7 天新增趋势</option>
            <option value="30">近 30 天新增趋势</option>
            <option value="90">近 90 天新增趋势</option>
          </select>
          <Button type="submit" variant="outline">
            查看统计
          </Button>
        </form>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`${ADMIN_PATH}/visitors/list${siteId ? `?siteId=${siteId}` : ""}`}
          >
            访客明细
          </Link>
        </Button>
      </div>
      <VisitorInsights data={data} adminPath={ADMIN_PATH} />
    </div>
  );
}
