import {
  formatVisitorNumber as number,
  formatVisitorPercent as percent,
  type VisitorBreakdownRow,
} from "./visitor-insights-shared";

const colors = [
  "#d49a1f",
  "#5f7f9e",
  "#c0623b",
  "#7f9f73",
  "#9a6b91",
  "#4a9690",
  "#c9ad7f",
  "#8c8174",
];

export function VisitorBreakdown({
  title,
  rows,
  total,
  tags = false,
}: {
  title: string;
  rows: VisitorBreakdownRow[];
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
                className="animate-grow-x h-full rounded-full"
                style={{
                  width: `${total ? Math.min(100, (row.count / total) * 100) : 0}%`,
                  backgroundColor: colors[index % colors.length],
                  animationDelay: `${index * 60}ms`,
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
