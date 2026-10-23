import { requireAdmin, HttpError } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import {
  defaultEfficiencyFilters,
  efficiencyDuration,
  efficiencyRate,
  type EfficiencyData,
} from "@/lib/efficiency";
import { beijingDay, reportTime } from "@/lib/reporting";
import {
  getEfficiency,
  getEfficiencyOptions,
} from "@/server/services/efficiency";
import {
  PageHeader,
  StatCard,
  EmptyState,
} from "@/components/admin/page-header";
import { EfficiencyGroups } from "@/components/admin/efficiency-groups";
import { EfficiencyFilters } from "./efficiency-filters";
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
  const summary = data?.summary;
  const max = Math.max(1, ...(data?.trend.map((row) => row.total) ?? []));
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
      {data && summary && (
        <>
          <p className="text-xs leading-6 text-muted-foreground">
            统计快照：{reportTime(new Date(data.asOf))}
            （北京时间）。以下数量和分组均限于所选日期内新建的会话；当前状态、接待人及评价会随后续处理变化，不代表历史时点快照。
          </p>
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="客服效率汇总"
          >
            <StatCard
              label="新建会话"
              value={summary.total}
              hint={`待接入 ${summary.pending} · 进行中 ${summary.open} · 已结束 ${summary.closed}`}
            />
            <StatCard
              label="当前待人工回复"
              value={summary.waiting}
              hint="未结束且仍有访客消息等待人工答复"
            />
            <StatCard
              label="平均首次响应"
              value={efficiencyDuration(summary.avgResponseSeconds)}
              hint={`${summary.responseSamples} 个有效样本；已首响占比 ${efficiencyRate(summary.responseSamples, summary.total)}`}
            />
            <StatCard
              label="90% 首响不超过"
              value={efficiencyDuration(summary.p90ResponseSeconds)}
              hint="P90：反映较慢的首次响应"
            />
            <StatCard
              label="平均结案耗时"
              value={efficiencyDuration(summary.avgCloseSeconds)}
              hint={`${summary.closeSamples} 个有效结案样本；含排队和离线等待`}
            />
            <StatCard
              label="当前结案占比"
              value={efficiencyRate(summary.closed, summary.total)}
              hint="当前状态为已结束的会话占比"
            />
            <StatCard
              label="平均评分"
              value={
                summary.avgRating === null
                  ? "—"
                  : `${summary.avgRating.toFixed(1)} / 5`
              }
              hint={`${summary.ratingSamples} 个有效评价；评价覆盖 ${efficiencyRate(summary.ratingSamples, summary.total)}`}
            />
            <StatCard
              label="满意评价占比"
              value={efficiencyRate(summary.satisfied, summary.ratingSamples)}
              hint={`${summary.satisfied} / ${summary.ratingSamples} 个评价为 4～5 分`}
            />
          </section>
          {summary.total === 0 && (
            <EmptyState
              title="所选范围暂无会话"
              description="可扩大日期范围，或切换站点、客服。没有样本时，时长和比例显示为“—”。"
            />
          )}
          <section
            className="min-w-0 space-y-4 rounded-lg border p-4 sm:p-5"
            aria-label="每日会话趋势"
          >
            <h2 className="font-semibold">每日新建会话与当前待回复</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              按会话创建日分组，红色部分为该日新建会话中当前仍待人工回复的数量。
            </p>
            <svg
              viewBox="0 0 900 180"
              className="h-auto w-full"
              role="img"
              aria-label="每日新建会话及其中当前待回复的柱状图，精确数值见下方每日数据"
            >
              <line
                x1="0"
                y1="160"
                x2="900"
                y2="160"
                stroke="currentColor"
                opacity="0.25"
              />
              {data.trend.map((row, i) => {
                const width = 900 / data.trend.length,
                  totalHeight = (row.total / max) * 140,
                  waitingHeight = (row.waiting / max) * 140;
                return (
                  <g key={row.day}>
                    <rect
                      x={i * width + 1}
                      y={160 - totalHeight}
                      width={Math.max(2, width - 2)}
                      height={totalHeight}
                      rx="1"
                      fill="currentColor"
                      opacity="0.35"
                    >
                      <title>{`${row.day}：新建 ${row.total}，当前待回复 ${row.waiting}`}</title>
                    </rect>
                    <rect
                      x={i * width + 1}
                      y={160 - waitingHeight}
                      width={Math.max(2, width - 2)}
                      height={waitingHeight}
                      rx="1"
                      fill="#dc2626"
                    >
                      <title>{`${row.day}：当前待回复 ${row.waiting}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{data.filters.from}</span>
              <span>{data.filters.to}</span>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                查看每日数据
              </summary>
              <div
                tabIndex={0}
                role="region"
                aria-label="每日客服效率数据表"
                className="mt-3 max-h-80 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["创建日期", "新建", "当前待回复", "当前已结案"].map(
                        (text) => (
                          <th
                            key={text}
                            scope="col"
                            className="whitespace-nowrap p-2 font-medium"
                          >
                            {text}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((row) => (
                      <tr key={row.day} className="border-t">
                        <th
                          scope="row"
                          className="whitespace-nowrap p-2 font-normal"
                        >
                          {row.day}
                        </th>
                        <td className="p-2">{row.total}</td>
                        <td className="p-2">{row.waiting}</td>
                        <td className="p-2">{row.closed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <EfficiencyGroups
            title="站点分组"
            rows={data.sites}
            totalGroups={data.siteGroups}
            platform={actor.role === "ADMIN"}
          />
          <EfficiencyGroups
            title="客服分组"
            rows={data.agents}
            totalGroups={data.agentGroups}
            platform={actor.role === "ADMIN"}
          />
          <section
            className="space-y-2 rounded-lg border p-4 text-xs leading-6 text-muted-foreground"
            aria-label="客服效率统计口径"
          >
            <h2 className="text-sm font-medium text-foreground">统计口径</h2>
            <p>
              客服筛选和分组按当前／最后接待人归属。转接前的首响仍计入整段会话，不拆分每位客服的贡献；未分配包含原接待账号已删除的会话。停用站点及账号的历史数据保留。
            </p>
            <p>
              首响从会话创建到首次人工公开回复，文本、图片、文件均算回复，内部备注、已读、系统消息及
              AI
              自动回复不算。结案耗时从创建到最近一次结案，包含等待、非工作时间和重新打开前的时间，不是客服实际工作时长。
            </p>
            <p>
              当前待回复按等待状态判断；历史缺少等待字段时根据访客与人工公开消息补充判断。只统计当前未结束的会话，与仅在启用规则后生成的提醒数量不同。评价使用会话当前保留的有效
              1～5 分，4～5
              分为满意；不按评价提交日统计。所有时长、分位数和比例显示对应样本数，缺样本显示“—”。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
