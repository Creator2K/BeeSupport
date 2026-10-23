export type VisitorBreakdownRow = { label: string; count: number };

export function formatVisitorNumber(value: number) {
  return value.toLocaleString("zh-CN");
}

export function formatVisitorPercent(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}
