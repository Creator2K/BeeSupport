import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import {
  unansweredFilterSchema,
  unansweredResolutions,
} from "@/lib/unanswered";
import { reportTime } from "@/lib/reporting";
import { listUnansweredReminders } from "@/server/services/unanswered";
import {
  PageHeader,
  StatCard,
  EmptyState,
} from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button } from "@/components/ui/button";

export async function UnansweredBoard({
  searchParams,
  basePath,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  basePath: string;
}) {
  const actor = await requireUser(),
    params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const parsed = unansweredFilterSchema.safeParse({
    query: value("query"),
    siteId: value("siteId"),
    status: value("status") || "ACTIVE",
    mine: value("mine"),
  });
  const filters = parsed.success
    ? parsed.data
    : unansweredFilterSchema.parse({});
  if (actor.role === "AGENT") filters.mine = "1";
  const [data, sites] = await Promise.all([
    listUnansweredReminders(actor, filters, Number(value("page"))),
    prisma.site.findMany({
      where: {
        ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
        ...(actor.siteIds === null ? {} : { id: { in: actor.siteIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const field =
    "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
  return (
    <div className="space-y-5">
      <PageHeader
        title="长时间未回复提醒"
        description="查看等待人工回复超过站点设定时长的会话。同一轮等待只提醒一次，请进入会话回复或结束处理。"
        actions={
          <div className="flex flex-wrap gap-2">
            {actor.role !== "AGENT" && (
              <Button asChild variant="outline">
                <a href={`${ADMIN_PATH}/follow-ups/rules`}>配置提醒规则</a>
              </Button>
            )}
            <Button asChild variant="outline">
              <a href="/agent">返回客服工作台</a>
            </Button>
          </div>
        }
      />
      {!parsed.success && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          筛选条件无效，已恢复默认筛选。
        </p>
      )}
      <section className="grid grid-cols-2 gap-3" aria-label="未回复提醒统计">
        <StatCard label="待回复提醒" value={data.active} />
        <StatCard label="符合筛选的记录" value={data.total} />
      </section>
      <form
        action={basePath}
        aria-label="筛选未回复提醒"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          关键词
          <input
            name="query"
            defaultValue={filters.query}
            maxLength={120}
            className={field}
            placeholder="访客、邮箱或会话主题"
          />
        </label>
        <label
          className="flex min-w-0 flex-col gap-1 text-sm"
          htmlFor="unanswered-filter-status"
        >
          提醒状态
          <select
            id="unanswered-filter-status"
            name="status"
            defaultValue={filters.status}
            className={field}
          >
            <option value="ACTIVE">待回复</option>
            <option value="RESOLVED">已结束提醒</option>
            <option value="ALL">全部记录</option>
          </select>
        </label>
        <label
          className="flex min-w-0 flex-col gap-1 text-sm"
          htmlFor="unanswered-filter-site"
        >
          站点
          <select
            id="unanswered-filter-site"
            name="siteId"
            defaultValue={filters.siteId}
            className={field}
          >
            <option value="">全部站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex min-w-0 flex-col gap-1 text-sm"
          htmlFor="unanswered-filter-mine"
        >
          接收人范围
          <select
            id="unanswered-filter-mine"
            name="mine"
            defaultValue={filters.mine}
            className={field}
          >
            {actor.role !== "AGENT" && <option value="">全部记录</option>}
            <option value="1">发给我的提醒</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-10 self-end">
          筛选提醒
        </Button>
      </form>
      <p className="text-xs leading-6 text-muted-foreground">
        待回复数量遵循关键词、站点和接收人范围。客服仅能查看发给自己且仍有站点权限的提醒；管理员可查看权限范围内的记录。站点、商家或规则暂停时，记录不计入待回复。时间为北京时间。
      </p>
      {data.rows.length ? (
        <div className="space-y-3">
          {data.rows.map((row) => (
            <article
              key={row.id}
              aria-label={`未回复提醒 ${row.id}`}
              className="space-y-3 rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="min-w-0 break-all text-sm font-semibold">
                  {row.visitorName || row.visitorEmail}
                </h2>
                <span
                  className={
                    row.active
                      ? "rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {row.active
                    ? "等待人工回复"
                    : row.resolution
                      ? unansweredResolutions[row.resolution] || "提醒已结束"
                      : "提醒已暂停"}
                </span>
              </div>
              <p className="break-all text-sm">{row.subject || "访客咨询"}</p>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">开始等待：</dt>
                  <dd className="inline">
                    {reportTime(new Date(row.waitingSince))}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">提醒时间：</dt>
                  <dd className="inline">
                    {reportTime(new Date(row.remindedAt))}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">接收人：</dt>
                  <dd className="inline break-all">
                    {row.recipientName}
                    {!row.recipientActive ? "（账号不可用）" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">站点：</dt>
                  <dd className="inline break-all">{row.siteName}</dd>
                </div>
                {row.resolvedAt && (
                  <div>
                    <dt className="inline text-muted-foreground">提醒结束：</dt>
                    <dd className="inline">
                      {reportTime(new Date(row.resolvedAt))}
                    </dd>
                  </div>
                )}
              </dl>
              <Button asChild variant="outline" size="sm">
                <a href={`/agent?c=${encodeURIComponent(row.conversationId)}`}>
                  打开会话处理
                </a>
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="暂无符合条件的未回复提醒"
          description="启用规则后，超过等待时长的会话会出现在这里；已处理的记录可切换状态查看。"
        />
      )}
      <ListPagination {...data} basePath={basePath} filters={filters} />
    </div>
  );
}
