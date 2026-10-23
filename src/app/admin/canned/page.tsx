import { PageHeader } from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getServerT } from "@/lib/i18n/server";
import { adminDb } from "@/lib/tenant-db";
import { cannedSearchSchema } from "@/lib/canned";
import { listManagedCanned } from "@/server/services/canned";
import { CannedClient } from "./canned-client";

export const metadata = { title: "快捷话术" };
export const dynamic = "force-dynamic";
const field =
  "h-10 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm";
export default async function CannedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  const prisma = await adminDb();
  const { t } = await getServerT();
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const parsed = cannedSearchSchema.safeParse({
    query: value("query"),
    category: value("category"),
    siteId: value("siteId"),
    visibility: value("visibility"),
  });
  const filters = parsed.success ? parsed.data : cannedSearchSchema.parse({});
  const [data, sites] = await Promise.all([
    listManagedCanned(actor, filters, Number(value("page"))),
    prisma.site.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("canned.title")}
        description={t("canned.subtitle")}
      />
      {!parsed.success && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          筛选条件无效，已恢复默认筛选。
        </p>
      )}
      <form
        action={`${ADMIN_PATH}/canned`}
        aria-label="筛选快捷话术"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          {t("common.search")}
          <input
            name="query"
            maxLength={120}
            defaultValue={filters.query}
            placeholder={t("canned.searchHint")}
            className={field}
          />
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="canned-filter-category">{t("canned.category")}</label>
          <input
            id="canned-filter-category"
            name="category"
            maxLength={30}
            list="canned-filter-categories"
            defaultValue={filters.category}
            placeholder={t("canned.allCategories")}
            className={field}
          />
          <datalist id="canned-filter-categories">
            {data.categories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="canned-filter-site">{t("canned.scope")}</label>
          <select
            id="canned-filter-site"
            name="siteId"
            defaultValue={filters.siteId}
            className={field}
          >
            <option value="">{t("canned.scopeGlobal")}</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="canned-filter-visibility">
            {t("canned.visibility")}
          </label>
          <select
            id="canned-filter-visibility"
            name="visibility"
            defaultValue={filters.visibility}
            className={field}
          >
            <option value="">{t("canned.allVisibility")}</option>
            <option value="shared">{t("canned.shared")}</option>
            <option value="private">{t("canned.private")}</option>
          </select>
        </div>
        <Button type="submit" variant="outline" className="h-10 self-end">
          {t("common.search")}
        </Button>
      </form>
      <CannedClient
        items={data.items.map((item) => ({
          ...item,
          siteName: item.site?.name ?? null,
          ownerName: item.owner?.name ?? null,
          tenantName: actor.role === "ADMIN" ? item.tenant.name : null,
        }))}
        sites={sites}
        categories={data.categories}
        total={data.total}
      />
      <ListPagination
        {...data}
        basePath={`${ADMIN_PATH}/canned`}
        filters={filters}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        {t("canned.privacyHint")}
      </p>
    </div>
  );
}
