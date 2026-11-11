"use client";

import { useState } from "react";

import { formatVisitorNumber as number } from "./visitor-insights-shared";

type TrendRow = { day: string; count: number };

export function VisitorTrend({
  trend,
  totalVisitors,
}: {
  trend: TrendRow[];
  totalVisitors: number;
}) {
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const max = Math.max(1, ...trend.map((row) => row.count));
  const day = activeDay === null ? null : (trend[activeDay] ?? null);
  const labelIndexes = Array.from(
    new Set([0, Math.floor(trend.length / 2), trend.length - 1]),
  ).filter((index) => index >= 0 && index < trend.length);

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">新增访客趋势</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            近 {trend.length} 天首次登记的访客 · 北京时间
          </p>
        </div>
        <p aria-live="polite" className="text-sm tabular-nums">
          {day
            ? `${day.day} · ${number(day.count)} 位新增访客`
            : `合计 ${number(trend.reduce((sum, row) => sum + row.count, 0))} 位新增访客`}
        </p>
      </div>
      <div
        className="relative mt-6 h-52 border-b"
        role="group"
        aria-label="新增访客每日统计"
      >
        <div className="absolute inset-0 flex items-end gap-px sm:gap-1">
          {trend.map((row, index) => (
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
                className={`w-full rounded-t-sm transition-colors ${activeDay === index ? "bg-brand" : "bg-brand-strong/85 dark:bg-brand/60"}`}
                style={{
                  height: `${Math.max(row.count ? 2 : 0.7, (row.count / max) * 95)}%`,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
        {labelIndexes.map((index) => (
          <span key={trend[index].day}>{trend[index].day.slice(5)}</span>
        ))}
      </div>
      {totalVisitors === 0 && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          尚无访客记录，访客开始咨询后将自动形成统计。
        </p>
      )}
    </section>
  );
}
