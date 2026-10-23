import type { VisitorAnalytics } from "@/server/services/visitor-analytics";

import { VisitorBreakdown } from "./visitor-breakdown";
import { VisitorMetricCards } from "./visitor-metric-cards";
import { VisitorSitesTable } from "./visitor-sites-table";
import { VisitorTrend } from "./visitor-trend";

export function VisitorInsights({
  data,
  adminPath,
}: {
  data: VisitorAnalytics;
  adminPath: string;
}) {
  const { totals } = data;

  return (
    <div className="min-w-0 space-y-5">
      <VisitorMetricCards totals={totals} />
      <VisitorTrend
        trend={data.trend}
        totalVisitors={totals.visitors}
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <VisitorBreakdown
          title="设备分布"
          rows={data.devices}
          total={totals.visitors}
        />
        <VisitorBreakdown
          title="浏览器分布"
          rows={data.browsers}
          total={totals.visitors}
        />
        <VisitorBreakdown
          title="操作系统"
          rows={data.systems}
          total={totals.visitors}
        />
        <VisitorBreakdown
          title="语言偏好"
          rows={data.languages}
          total={totals.visitors}
        />
        <VisitorBreakdown
          title="访问来源"
          rows={data.sources}
          total={totals.visitors}
        />
        <VisitorBreakdown
          title="访客标签覆盖"
          rows={data.tags}
          total={totals.visitors}
          tags
        />
      </div>
      <VisitorSitesTable sites={data.sites} adminPath={adminPath} />
      <p className="text-xs leading-6 text-muted-foreground">
        统计口径：上方指标与分布为累计数据，新增趋势按首次登记时间计算。访客以“站点
        +
        浏览器标识”区分，同一人在不同浏览器可能重复；设备、语言来自访客端上报，缺失信息显示为未知。
      </p>
    </div>
  );
}
