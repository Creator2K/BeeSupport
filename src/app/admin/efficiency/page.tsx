import { requireAdmin, HttpError } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import {
  defaultEfficiencyFilters,
  type EfficiencyData,
} from "@/lib/efficiency";
import { beijingDay } from "@/lib/reporting";
import {
  getEfficiency,
  getEfficiencyOptions,
} from "@/server/services/efficiency";
import { PageHeader } from "@/components/admin/page-header";
import { EfficiencyFilters } from "./efficiency-filters";
import { EfficiencyReport } from "./efficiency-report";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";
export const metadata = { title: "客服效率看板" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin(),
    params = await searchParams,
    now = new Date(),
    defaults = defaultEfficiencyFilters(now),
    path = `${ADMIN_PATH}/efficiency`;
  const read = (key: keyof typeof defaults) =>
    typeof params[key] === "string" ? (params[key] as string) : defaults[key];
  const filters = {
    from: read("from"),
    to: read("to"),
    siteId: read("siteId"),
    agentId: read("agentId"),
  };
  const options = await getEfficiencyOptions(actor);
  let data: EfficiencyData | null = null,
    error = "";
  try {
    data = await getEfficiency(actor, filters, now);
  } catch (cause) {
    if (cause instanceof HttpError) error = cause.message;
    else if (cause instanceof ZodError)
      error = "筛选条件无效，请选择有效日期和筛选范围。";
    else throw cause;
  }
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="客服效率看板"
        description="查看所选日期内新建会话的首响、结案、当前待回复和满意度。日期统一使用北京时间。"
      />
      <EfficiencyFilters
        key={JSON.stringify(filters)}
        filters={filters}
        options={options}
        action={path}
        today={beijingDay(now)}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {[7, 30, 90].map((days) => {
          const query = new URLSearchParams({
            ...filters,
            from: beijingDay(new Date(now.getTime() - (days - 1) * 86400000)),
            to: beijingDay(now),
          });
          return (
            <a
              className="underline underline-offset-4"
              key={days}
              href={`${path}?${query}`}
            >
              近 {days} 天
            </a>
          );
        })}
        <a
          href={path}
          className="text-muted-foreground underline underline-offset-4"
        >
          重置筛选
        </a>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 p-3 text-sm text-red-800 dark:border-red-900 dark:text-red-300"
        >
          {error} 请调整筛选后重新查询。
        </p>
      )}
      {data && (
        <EfficiencyReport
          data={data}
          platform={actor.role === "ADMIN"}
        />
      )}
    </div>
  );
}
