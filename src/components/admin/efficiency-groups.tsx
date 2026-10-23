import {
  efficiencyDuration,
  efficiencyRate,
  type EfficiencyGroup,
} from "@/lib/efficiency";
export function EfficiencyGroups({
  title,
  rows,
  totalGroups,
  platform,
}: {
  title: string;
  rows: EfficiencyGroup[];
  totalGroups: number;
  platform: boolean;
}) {
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4 sm:p-5"
      aria-label={title}
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="text-xs leading-6 text-muted-foreground">
        按会话量展示前 20 组（共 {totalGroups}{" "}
        组），汇总和趋势涵盖全部数据。可用上方筛选查看指定站点或客服。
      </p>
      {rows.length ? (
        <div
          role="region"
          tabIndex={0}
          aria-label={`${title}数据表`}
          className="max-w-full overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "归属",
                  "会话量",
                  "待回复",
                  "平均首响",
                  "P90 首响",
                  "平均结案",
                  "满意占比",
                ].map((text) => (
                  <th
                    key={text}
                    scope="col"
                    className="whitespace-nowrap px-3 py-3 font-medium"
                  >
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? "unassigned"} className="border-t">
                  <th
                    scope="row"
                    className="min-w-36 max-w-64 break-words px-3 py-3 font-medium"
                  >
                    {row.name}
                    {row.active === false && (
                      <span className="ml-1 text-muted-foreground">
                        （已停用）
                      </span>
                    )}
                    {platform && row.tenantName && (
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                        {row.tenantName}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-3 tabular-nums">{row.total}</td>
                  <td className="px-3 py-3 tabular-nums">{row.waiting}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {efficiencyDuration(row.avgResponseSeconds)}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {row.responseSamples} 个样本
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {efficiencyDuration(row.p90ResponseSeconds)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {efficiencyDuration(row.avgCloseSeconds)}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {row.closeSamples} 个样本
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {efficiencyRate(row.satisfied, row.ratingSamples)}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {row.ratingSamples} 个评价
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">暂无分组数据</p>
      )}
    </section>
  );
}
