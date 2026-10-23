import { requireUser } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { prisma } from "@/lib/db";
import { followUpFilters, followUpFilterSchema } from "@/lib/follow-ups";
import { reportTime } from "@/lib/reporting";
import { listFollowUps } from "@/server/services/follow-ups";
import {
  PageHeader,
  StatCard,
  EmptyState,
} from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button } from "@/components/ui/button";
import { FollowUpLauncher } from "./follow-up-launcher";

export async function FollowUpBoard({
  searchParams,
  basePath,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  basePath: string;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const parsed = followUpFilterSchema.safeParse({
    query: value("query"),
    siteId: value("siteId"),
    status: value("status") || "OPEN",
    mine: value("mine"),
  });
  const filters = parsed.success ? parsed.data : followUpFilterSchema.parse({});
  if (user.role === "AGENT") filters.mine = "1";
  const [data, sites] = await Promise.all([
    listFollowUps(user, filters, Number(value("page"))),
    prisma.site.findMany({
      where: {
        ...(user.role === "ADMIN" ? {} : { tenantId: user.tenantId }),
        ...(user.siteIds === null ? {} : { id: { in: user.siteIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const field =
    "h-10 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm";
  return (
    <div className="space-y-5">
      <PageHeader
        title="会话跟进待办"
        description="集中处理离线留言和会话后续事项。完成任务与结束会话分别操作，跟进事项仅内部可见。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a
                href={
                  user.role === "AGENT"
                    ? "/agent/unanswered"
                    : `${ADMIN_PATH}/follow-ups/unanswered`
                }
              >
                未回复提醒
              </a>
            </Button>
            {user.role !== "AGENT" && (
              <Button asChild variant="outline">
                <a href={`${ADMIN_PATH}/follow-ups/rules`}>自动跟进规则</a>
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
      <section className="grid grid-cols-3 gap-3" aria-label="跟进任务统计">
        <StatCard label="待跟进" value={data.counts.open} />
        <StatCard label="已到期" value={data.counts.overdue} />
        <StatCard label="今日待办" value={data.counts.today} />
      </section>
      <form
        action={basePath}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="筛选跟进任务"
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          关键词
          <input
            name="query"
            defaultValue={filters.query}
            maxLength={120}
            placeholder="访客、邮箱、主题或跟进事项"
            className={field}
          />
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="followup-filter-status">任务状态</label>
          <select
            id="followup-filter-status"
            name="status"
            defaultValue={filters.status}
            className={field}
          >
            {Object.entries(followUpFilters).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="followup-filter-site">站点</label>
          <select
            id="followup-filter-site"
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
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="followup-filter-mine">负责人范围</label>
          <select
            id="followup-filter-mine"
            name="mine"
            defaultValue={filters.mine}
            className={field}
          >
            {user.role !== "AGENT" && <option value="">全部任务</option>}
            <option value="1">我的任务</option>
          </select>
        </div>
        <Button type="submit" variant="outline" className="h-10 self-end">
          筛选任务
        </Button>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">
        统计遵循站点、关键词及负责人范围，不随任务状态筛选变化。今日待办含今天已经到期的任务，时间统一为北京时间。客服仅显示自己负责且仍有站点权限的任务。
      </p>
      {data.rows.length ? (
        <div className="space-y-3">
          {data.rows.map((task) => (
            <article
              key={task.id}
              aria-label={`跟进任务 ${task.id}`}
              className="space-y-3 rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 break-all text-sm font-semibold">
                  {task.visitorName || task.visitorEmail}
                </h2>
                <span
                  className={
                    task.overdue
                      ? "rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {task.overdue ? "已到期" : followUpFilters[task.status]}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-all text-sm leading-6">
                {task.note}
              </p>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">跟进时间：</dt>
                  <dd className="inline">
                    {reportTime(new Date(task.dueAt))}（北京时间）
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">负责人：</dt>
                  <dd className="inline break-all">
                    {task.ownerName ?? "未分配（原负责人已删除）"}
                    {task.ownerId && !task.ownerActive ? "（账号已停用）" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">站点：</dt>
                  <dd className="inline break-all">{task.siteName}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">会话：</dt>
                  <dd className="inline">
                    {task.source === "OFFLINE_FORM" ? "离线留言" : "在线咨询"} ·{" "}
                    {task.conversationStatus === "CLOSED"
                      ? "已结束"
                      : task.conversationStatus === "OPEN"
                        ? "进行中"
                        : "待接入"}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <FollowUpLauncher
                  conversationId={task.conversationId}
                  refreshList
                />
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/agent?c=${encodeURIComponent(task.conversationId)}`}
                  >
                    打开会话
                  </a>
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="暂无符合条件的跟进任务"
          description="在聊天窗口点击会话跟进，可为离线留言或咨询安排后续处理。"
        />
      )}
      <ListPagination {...data} basePath={basePath} filters={filters} />
    </div>
  );
}
