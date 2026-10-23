import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { defaultReportDates } from "@/lib/reporting";
import { ExportForm } from "./export-form";

export const metadata = { title: "数据导出" };
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  const db = await adminDb();
  const sites = await db.site.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const params = await searchParams;
  const initial = Object.fromEntries(
    ["kind", "from", "to", "query", "action"].map((key) => [
      key,
      typeof params[key] === "string" ? (params[key] as string) : "",
    ]),
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="数据导出"
        description={
          actor.role === "ADMIN"
            ? "按日期和条件导出平台数据，每次下载保留操作日志。"
            : "导出本商家的业务数据，每次下载保留操作日志。"
        }
      />
      <ExportForm
        sites={sites}
        dates={defaultReportDates()}
        initial={initial}
      />
    </div>
  );
}
