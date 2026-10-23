import Link from "next/link";

import {
  formatVisitorNumber as number,
  formatVisitorPercent as percent,
} from "./visitor-insights-shared";

type VisitorSiteRow = {
  id: string;
  name: string;
  visitors: number;
  visits: number;
  views: number;
  consulted: number;
};

export function VisitorSitesTable({
  sites,
  adminPath,
}: {
  sites: VisitorSiteRow[];
  adminPath: string;
}) {
  return (
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
            {sites.map((site) => (
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
        {!sites.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            暂无站点访客数据
          </p>
        )}
      </div>
    </section>
  );
}
