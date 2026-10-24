import type { EfficiencyData } from "@/lib/efficiency";

export function EfficiencyTrend({ data }: { data: EfficiencyData }) {
  const max = Math.max(1, ...(data.trend.map((row) => row.total) ?? []));
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border p-4 sm:p-5"
      aria-label="每日会话趋势"
    >
      <h2 className="font-semibold">每日新建会话与当前待回复</h2>
      <p className="text-xs leading-6 text-muted-foreground">
        按会话创建日分组，红色部分为该日新建会话中当前仍待人工回复的数量。
      </p>
      <svg
        viewBox="0 0 900 180"
        className="h-auto w-full"
        role="img"
        aria-label="每日新建会话及其中当前待回复的柱状图，精确数值见下方每日数据"
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
          const width = 900 / data.trend.length,
            totalHeight = (row.total / max) * 140,
            waitingHeight = (row.waiting / max) * 140;
          return (
            <g key={row.day}>
              <rect
                x={i * width + 1}
                y={160 - totalHeight}
                width={Math.max(2, width - 2)}
                height={totalHeight}
                rx="1"
                fill="currentColor"
                opacity="0.35"
              >
                <title>{`${row.day}：新建 ${row.total}，当前待回复 ${row.waiting}`}</title>
              </rect>
              <rect
                x={i * width + 1}
                y={160 - waitingHeight}
                width={Math.max(2, width - 2)}
                height={waitingHeight}
                rx="1"
                fill="#dc2626"
              >
                <title>{`${row.day}：当前待回复 ${row.waiting}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{data.filters.from}</span>
        <span>{data.filters.to}</span>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          查看每日数据
        </summary>
        <div
          tabIndex={0}
          role="region"
          aria-label="每日客服效率数据表"
          className="mt-3 max-h-80 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["创建日期", "新建", "当前待回复", "当前已结案"].map(
                  (text) => (
                    <th
                      key={text}
                      scope="col"
                      className="whitespace-nowrap p-2 font-medium"
                    >
                      {text}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.trend.map((row) => (
                <tr key={row.day} className="border-t">
                  <th
                    scope="row"
                    className="whitespace-nowrap p-2 font-normal"
                  >
                    {row.day}
                  </th>
                  <td className="p-2">{row.total}</td>
                  <td className="p-2">{row.waiting}</td>
                  <td className="p-2">{row.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
