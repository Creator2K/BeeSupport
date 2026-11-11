import Link from "next/link";
import { PageHeader, StatCard } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requirePlatformPage } from "@/lib/platform-page";
import { ADMIN_PATH } from "@/lib/app-paths";
import { formatPrice } from "@/lib/subscriptions";
import { getOperations } from "@/server/services/operations";
export const dynamic = "force-dynamic";
export const metadata = { title: "平台运营看板" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePlatformPage(),
    params = await searchParams;
  const data = await getOperations(user, Number(params.days)),
    s = data.summary;
  const maxRevenue = Math.max(1, ...data.trend.map((row) => row.revenueCents));
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="平台运营看板"
        description="查看商家入驻、服务状态和人工确认订单。统计不包含系统默认商家，日期按北京时间计算。"
      />
      <form className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="operations-days">
          统计周期
        </label>
        <select
          id="operations-days"
          name="days"
          defaultValue={data.days}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
        </select>
        <Button variant="outline" type="submit">
          查看运营数据
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [
            "已确认订单金额",
            formatPrice(s.revenueCents),
            `${s.confirmed} 笔已开通订单，按确认时间统计`,
          ],
          [
            "新增入驻",
            String(s.applicants),
            `当前已开通 ${s.activated} 家（含已到期）`,
          ],
          [
            "当前正常服务",
            `${s.serving} / ${s.total}`,
            `待审核 ${s.pending} · 已到期 ${s.expired} · 已停用 ${s.suspended}`,
          ],
          [
            "待核对订单",
            String(s.pendingOrders),
            `其中 ${s.reportedOrders} 笔已反馈付款`,
          ],
          [
            "复购商家占比",
            s.buyers
              ? `${Math.round((s.repeatBuyers / s.buyers) * 100)}%`
              : "—",
            `${s.repeatBuyers} / ${s.buyers} 家本期下单并已确认的商家`,
          ],
          [
            "未来 7 天到期",
            String(s.expiring),
            "仅统计状态正常、尚未到期的商家",
          ],
          [
            "已检测到网站接入",
            String(s.installed),
            "启用商家至少一个启用站点曾上报真实嵌入",
          ],
          [
            "近 7 天无咨询活动",
            String(s.inactive),
            "启用商家近 7 天没有会话更新，含尚未接入者",
          ],
        ].map(([label, value, hint]) => (
          <StatCard key={label} label={label} value={value} hint={hint} />
        ))}
      </div>
      <section className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-6">
        <h2 className="font-semibold">每日确认订单金额</h2>
        <svg
          viewBox="0 0 900 180"
          role="img"
          aria-label={`近 ${data.days} 天人工确认订单金额柱状图，详细数值见下方每日数据`}
          className="h-auto w-full"
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
            const height = (row.revenueCents / maxRevenue) * 140;
            return (
              <rect
                key={row.day}
                x={(i * 900) / data.days + 2}
                y={160 - height}
                width={Math.max(2, 900 / data.days - 4)}
                height={height}
                rx="2"
                className="fill-brand-strong"
              >
                <title>{`${row.day}：${formatPrice(row.revenueCents)}`}</title>
              </rect>
            );
          })}
        </svg>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{data.trend[0].day}</span>
          <span>{data.trend.at(-1)!.day}</span>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">查看每日数据</summary>
          <div
            tabIndex={0}
            role="region"
            aria-label="每日运营数据表"
            className="mt-3 max-h-80 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">日期</th>
                  <th className="p-2">新增入驻</th>
                  <th className="p-2">确认金额</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((row) => (
                  <tr key={row.day} className="border-t">
                    <td className="p-2 whitespace-nowrap">{row.day}</td>
                    <td className="p-2">{row.applicants}</td>
                    <td className="p-2">{formatPrice(row.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="text-xs leading-6 text-muted-foreground">
          确认金额使用订单报价快照，包含免费订单，不代表自动支付账单；待确认、拒绝、取消及过期订单不计入。复购指本期至少一笔订单已确认、截至统计时累计至少两笔订单已确认的商家。
        </p>
      </section>
      <section className="space-y-3 rounded-xl border p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">临近到期商家（最多 10 家）</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`${ADMIN_PATH}/merchants`}>管理商家</Link>
          </Button>
        </div>
        {data.expiring.length ? (
          data.expiring.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"
            >
              <Link
                className="break-words underline"
                href={`${ADMIN_PATH}/merchants?search=${encodeURIComponent(row.slug)}`}
              >
                {row.name}
              </Link>
              <time className="text-muted-foreground">
                {new Date(row.expiresAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </time>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            未来 7 天暂无即将到期的商家。
          </p>
        )}
      </section>
    </div>
  );
}
