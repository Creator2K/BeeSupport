import Link from "next/link";
import { requirePlatformPage } from "@/lib/platform-page";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getSmtpConfig } from "@/lib/mail";
import { deliveryKinds, deliveryStates } from "@/lib/deliveries";
import { checkReadiness } from "@/server/health";
import { getDeliveries } from "@/server/services/deliveries";
import {
  PageHeader,
  StatCard,
  EmptyState,
} from "@/components/admin/page-header";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button } from "@/components/ui/button";
import { DeliveryRecords, DeliveryRefresh } from "./delivery-records";

export const dynamic = "force-dynamic";
export const metadata = { title: "通知投递管理" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePlatformPage();
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const kind = Object.hasOwn(deliveryKinds, value("kind")) ? value("kind") : "";
  const state = Object.hasOwn(deliveryStates, value("state"))
    ? value("state")
    : "";
  const search = value("search").trim().slice(0, 100);
  const [data, health, smtp] = await Promise.all([
    getDeliveries(admin, {
      days: Number(value("days")) || 7,
      kind,
      state,
      search,
      page: Number(value("page")),
    }),
    checkReadiness(),
    getSmtpConfig(),
  ]);
  const labels: Record<string, string> = {
    ok: "正常",
    error: "异常",
    timeout: "检测超时",
    not_configured: "未配置（单实例模式）",
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="通知投递管理"
        description="查看邮件与 Webhook 通知的处理情况。失败任务可核对配置后重新排队，每次重试保留审计记录。"
        actions={<DeliveryRefresh />}
      />
      <section aria-label="系统状态" className="grid gap-3 sm:grid-cols-3">
        <StatCard label="数据库" value={labels[health.checks.database]} />
        <StatCard label="Redis" value={labels[health.checks.redis]} />
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">邮件服务</p>
          <p className="mt-1.5 text-lg font-semibold">
            {smtp ? "已配置 SMTP" : "尚未配置"}
          </p>
          <Link
            href={`${ADMIN_PATH}/settings`}
            className="mt-2 inline-block text-xs underline"
          >
            配置及测试邮件
          </Link>
        </div>
      </section>
      <form
        className="flex flex-wrap items-center gap-2"
        aria-label="筛选通知任务"
      >
        <input
          name="search"
          aria-label="任务编号"
          defaultValue={search}
          placeholder="搜索任务编号"
          maxLength={100}
          className="h-9 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm"
        />
        <select
          name="days"
          aria-label="时间范围"
          defaultValue={String(data.days)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {[7, 30, 90].map((days) => (
            <option value={days} key={days}>
              近 {days} 天
            </option>
          ))}
        </select>
        <select
          name="kind"
          aria-label="通知类型"
          defaultValue={kind}
          className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部类型</option>
          {Object.entries(deliveryKinds).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <select
          name="state"
          aria-label="处理状态"
          defaultValue={state}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部状态</option>
          {Object.entries(deliveryStates).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          筛选任务
        </Button>
      </form>
      <section
        aria-label="通知任务统计"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        {Object.entries(deliveryStates).map(([key, name]) => (
          <StatCard key={key} label={name} value={data.counts[key]} />
        ))}
      </section>
      <p className="text-xs leading-5 text-muted-foreground">
        统计按所选时间、类型和编号计算，不受状态筛选影响。超过 5
        分钟仍未处理或租约已过期的任务：{data.overdue} 条。SMTP
        已配置不代表可投递，请使用系统设置中的测试邮件确认。
      </p>
      {data.rows.length ? (
        <DeliveryRecords rows={data.rows} />
      ) : (
        <EmptyState
          title="暂无符合条件的通知任务"
          description="收到新咨询、申请账号邮件或产生到期提醒后，可在这里查看处理记录。"
        />
      )}
      <ListPagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        basePath={`${ADMIN_PATH}/deliveries`}
        filters={{ search, kind, state, days: String(data.days) }}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        自动发送最多尝试 5 次；人工重试开启新一轮并保留累计次数。已处理记录保留
        7 天、失败记录保留 30
        天，历史已处理记录未区分投递与跳过。页面仅显示安全分类，不显示通知正文、收件邮箱、账号链接或原始错误响应。
      </p>
    </div>
  );
}
