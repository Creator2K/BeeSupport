import { PageHeader, EmptyState } from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import {
  AUDIT_ACTION_LABELS,
  auditFilterSchema,
  defaultReportDates,
  reportDateRange,
} from "@/lib/reporting";
import { getAuditRecords } from "@/server/services/reporting";

export const metadata = { title: "操作日志" };
export const dynamic = "force-dynamic";
const field =
  "h-10 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm";
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const dates = defaultReportDates();
  let filters = {
    ...dates,
    query: value("query").trim().slice(0, 120),
    action: value("action").trim().slice(0, 100),
  };
  let error = "";
  const parsed = auditFilterSchema.safeParse({
    ...filters,
    from: value("from") || dates.from,
    to: value("to") || dates.to,
  });
  if (parsed.success) {
    try {
      reportDateRange(parsed.data.from, parsed.data.to);
      filters = parsed.data;
    } catch {
      error =
        "日期范围无效，已显示最近 30 天。请选择截至今天、跨度不超过 90 天的日期。";
    }
  } else {
    error = "筛选条件无效，已恢复最近 30 天的默认筛选。";
    filters = { ...dates, query: "", action: "" };
  }
  const data = await getAuditRecords(
    actor,
    filters,
    Number(value("page")) || 1,
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="操作日志"
        description="按北京时间、操作类型和关键词检索，查看账号操作与数据导出记录。"
        actions={
          <Button asChild variant="outline">
            <a
              href={`${ADMIN_PATH}/exports?${new URLSearchParams({ kind: "audit", ...filters })}`}
            >
              导出当前筛选
            </a>
          </Button>
        }
      />
      {error && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      <form
        action={`${ADMIN_PATH}/audit`}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="筛选操作日志"
      >
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          开始日期
          <input
            className={field}
            name="from"
            type="date"
            required
            max={dates.to}
            defaultValue={filters.from}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          结束日期
          <input
            className={field}
            name="to"
            type="date"
            required
            max={dates.to}
            defaultValue={filters.to}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span id="audit-action-label">操作类型</span>
          <input
            aria-labelledby="audit-action-label"
            className={field}
            name="action"
            list="audit-actions"
            maxLength={100}
            placeholder="全部类型或操作代码"
            defaultValue={filters.action}
          />
          <datalist id="audit-actions">
            {Object.entries(AUDIT_ACTION_LABELS).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </datalist>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          关键词
          <input
            className={field}
            name="query"
            maxLength={120}
            placeholder="人员、对象或 IP"
            defaultValue={filters.query}
          />
        </label>
        <Button type="submit" variant="outline" className="h-10 self-end">
          筛选日志
        </Button>
      </form>
      {data.rows.length ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间（北京时间）</TableHead>
                <TableHead>操作人员</TableHead>
                <TableHead>操作</TableHead>
                <TableHead className="hidden md:table-cell">对象</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {log.createdAt}
                  </TableCell>
                  <TableCell className="max-w-40 break-all text-sm">
                    {log.actorName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="max-w-48 whitespace-normal break-all text-xs"
                      title={log.action}
                    >
                      {log.actionLabel}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="hidden max-w-64 truncate text-xs text-muted-foreground md:table-cell"
                    title={log.targetId ?? undefined}
                  >
                    {log.targetType
                      ? `${log.targetType} ${log.targetId ?? ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {log.ip ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="暂无符合条件的操作日志"
          description="可调整日期、操作类型或关键词后重试。"
        />
      )}
      <ListPagination
        {...data}
        basePath={`${ADMIN_PATH}/audit`}
        filters={filters}
      />
    </div>
  );
}
