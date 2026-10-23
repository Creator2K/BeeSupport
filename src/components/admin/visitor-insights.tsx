"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  Eye,
  MousePointer2,
  MessagesSquare,
  Repeat2,
  Activity,
} from "lucide-react";
import type { VisitorAnalytics } from "@/server/services/visitor-analytics";

const colors = [
  "#10b981",
  "#3b82f6",
  "#a78bfa",
  "#f59e0b",
  "#ec4899",
  "#64748b",
  "#06b6d4",
  "#84cc16",
];
const number = (value: number) => value.toLocaleString("zh-CN");
const percent = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";

export function VisitorInsights({
  data,
  adminPath,
}: {
  data: VisitorAnalytics;
  adminPath: string;
}) {
  const { totals } = data;
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const max = Math.max(1, ...data.trend.map((row) => row.count));
  const day = activeDay === null ? null : data.trend[activeDay];
  const metrics = [
    {
      label: "累计访客",
      value: number(totals.visitors),
      hint: "按站点与浏览器标识去重",
      icon: Users,
    },
    {
      label: "累计访问次数",
      value: number(totals.visits),
      hint: "间隔超过 30 分钟计为新访问",
      icon: MousePointer2,
    },
    {
      label: "累计页面浏览",
      value: number(totals.views),
      hint: "访客已记录的页面浏览次数",
      icon: Eye,
    },
    {
      label: "咨询转化率",
      value: percent(totals.consulted, totals.visitors),
      hint: `${number(totals.consulted)} 位访客发起过咨询`,
      icon: MessagesSquare,
    },
    {
      label: "回访访客占比",
      value: percent(totals.returning, totals.visitors),
      hint: `${number(totals.returning)} 位访客有多次访问`,
      icon: Repeat2,
    },
    {
      label: "近 7 天活跃访客",
      value: number(totals.active7),
      hint: `当前有 ${number(totals.blocked)} 个身份被封禁`,
      icon: Activity,
    },
  ];
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {metrics.map(({ label, value, hint, icon: Icon }) => (
          <article
            key={label}
            className="min-w-0 rounded-xl border bg-card p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{label}</span>
              <Icon className="size-4 shrink-0" />
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
              {value}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              {hint}
            </p>
          </article>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">新增访客趋势</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              近 {data.trend.length} 天首次登记的访客 · 北京时间
            </p>
          </div>
          <p aria-live="polite" className="text-sm tabular-nums">
            {day
              ? `${day.day} · ${number(day.count)} 位新增访客`
              : `合计 ${number(data.trend.reduce((sum, row) => sum + row.count, 0))} 位新增访客`}
          </p>
        </div>
        <div
          className="relative mt-6 h-52 border-b"
          role="group"
          aria-label="新增访客每日统计"
        >
          <div className="absolute inset-0 flex items-end gap-px sm:gap-1">
            {data.trend.map((row, index) => (
              <button
                key={row.day}
                type="button"
                aria-label={`${row.day} 新增 ${row.count} 位访客`}
                title={`${row.day}：${row.count} 位`}
                onMouseEnter={() => setActiveDay(index)}
                onMouseLeave={() => setActiveDay(null)}
                onFocus={() => setActiveDay(index)}
                onBlur={() => setActiveDay(null)}
                className="group flex h-full min-w-0 flex-1 items-end rounded-t focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span
                  className={`w-full rounded-t-sm transition-colors ${activeDay === index ? "bg-emerald-400" : "bg-emerald-600/80"}`}
                  style={{
                    height: `${Math.max(row.count ? 2 : 0.7, (row.count / max) * 95)}%`,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
          {data.trend
            .filter((_, index) =>
              [
                0,
                Math.floor(data.trend.length / 2),
                data.trend.length - 1,
              ].includes(index),
            )
            .map((row) => (
              <span key={row.day}>{row.day.slice(5)}</span>
            ))}
        </div>
        {totals.visitors === 0 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            尚无访客记录，访客开始咨询后将自动形成统计。
          </p>
        )}
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Breakdown
          title="设备分布"
          rows={data.devices}
          total={totals.visitors}
        />
        <Breakdown
          title="浏览器分布"
          rows={data.browsers}
          total={totals.visitors}
        />
        <Breakdown
          title="操作系统"
          rows={data.systems}
          total={totals.visitors}
        />
        <Breakdown
          title="语言偏好"
          rows={data.languages}
          total={totals.visitors}
        />
        <Breakdown
          title="访问来源"
          rows={data.sources}
          total={totals.visitors}
        />
        <Breakdown
          title="访客标签覆盖"
          rows={data.tags}
          total={totals.visitors}
          tags
        />
      </div>
      <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="font-medium">站点访客与咨询转化</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          按访客数排序，展示前 20 个站点
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                {["站点", "访客", "访问次数", "页面浏览", "咨询转化"].map(
                  (label) => (
                    <th key={label} className="px-2 py-3 font-medium">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.sites.map((site) => (
                <tr key={site.id} className="border-b last:border-0">
                  <td className="max-w-44 px-2 py-3">
                    <Link
                      className="block truncate underline-offset-4 hover:underline"
                      href={`${adminPath}/visitors?siteId=${site.id}`}
                    >
                      {site.name}
                    </Link>
                  </td>
                  <td className="px-2 py-3 tabular-nums">
                    {number(site.visitors)}
                  </td>
                  <td className="px-2 py-3 tabular-nums">
                    {number(site.visits)}
                  </td>
                  <td className="px-2 py-3 tabular-nums">
                    {number(site.views)}
                  </td>
                  <td className="px-2 py-3 tabular-nums">
                    {percent(site.consulted, site.visitors)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {site.consulted} 人
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.sites.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无站点访客数据
            </p>
          )}
        </div>
      </section>
      <p className="text-xs leading-6 text-muted-foreground">
        统计口径：上方指标与分布为累计数据，新增趋势按首次登记时间计算。访客以“站点
        +
        浏览器标识”区分，同一人在不同浏览器可能重复；设备、语言来自访客端上报，缺失信息显示为未知。
      </p>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
  tags = false,
}: {
  title: string;
  rows: { label: string; count: number }[];
  total: number;
  tags?: boolean;
}) {
  const shown = rows.reduce((sum, row) => sum + row.count, 0);
  const items =
    !tags && shown < total
      ? [...rows, { label: "其他", count: total - shown }]
      : rows;
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="font-medium">{title}</h2>
      {tags && (
        <p className="mt-1 text-xs text-muted-foreground">
          一位访客可有多个标签，占比为标签覆盖率
        </p>
      )}
      <div className="mt-5 space-y-4">
        {items.map((row, index) => (
          <div key={`${row.label}-${index}`}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {number(row.count)} · {percent(row.count, total)}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={Math.max(1, total)}
              aria-valuenow={row.count}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total ? Math.min(100, (row.count / total) * 100) : 0}%`,
                  backgroundColor: colors[index % colors.length],
                }}
              />
            </div>
          </div>
        ))}
        {!items.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无数据
          </p>
        )}
      </div>
    </section>
  );
}
