import Link from "next/link";

import { RiskPagination } from "./risk-pagination";
import type { RiskEvent } from "./risk-types";

export function RiskEventsTable({
  events,
  basePath,
  page,
  total,
  previous,
  next,
}: {
  events: RiskEvent[];
  basePath: string;
  page: number;
  total: number;
  previous: string;
  next: string;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="font-medium">拦截记录</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        记录命中的规则和访问 IP，不保存被拦截的完整消息内容。同一来源重复触发同一条规则时，十分钟内只记一条。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              {["时间", "类型 / 命中内容", "站点", "IP", "访客"].map(
                (label) => (
                  <th key={label} className="px-2 py-3 font-medium">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b last:border-0">
                <td className="px-2 py-3">{event.createdLabel}</td>
                <td className="max-w-48 break-all px-2 py-3">
                  {event.kind === "IP" ? "IP 封禁" : "违禁词"}
                  <span className="mt-1 block text-muted-foreground">
                    {event.ruleValue}
                  </span>
                </td>
                <td className="px-2 py-3">{event.siteName}</td>
                <td className="px-2 py-3 font-mono">{event.ip}</td>
                <td className="px-2 py-3">
                  {event.visitorId ? (
                    <Link
                      className="underline underline-offset-4"
                      href={`${basePath.replace(/\/risk$/, "/visitors")}/${event.visitorId}`}
                    >
                      查看画像
                    </Link>
                  ) : (
                    "未建立身份"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            暂无拦截记录
          </p>
        )}
      </div>
      <RiskPagination
        page={page}
        total={total}
        previous={previous}
        next={next}
      />
    </section>
  );
}
