import {
  Activity,
  Eye,
  MessagesSquare,
  MousePointer2,
  Repeat2,
  Users,
} from "lucide-react";
import type { VisitorAnalytics } from "@/server/services/visitor-analytics";

import {
  formatVisitorNumber as number,
  formatVisitorPercent as percent,
} from "./visitor-insights-shared";

export function VisitorMetricCards({
  totals,
}: {
  totals: VisitorAnalytics["totals"];
}) {
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
  );
}
