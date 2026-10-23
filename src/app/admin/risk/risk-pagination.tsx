import Link from "next/link";

import { Button } from "@/components/ui/button";

export function RiskPagination({
  page,
  total,
  previous,
  next,
}: {
  page: number;
  total: number;
  previous: string;
  next: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页
      </span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          <Link
            href={page <= 1 ? "#" : previous}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            className={page <= 1 ? "pointer-events-none opacity-50" : ""}
          >
            上一页
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          disabled={page * 20 >= total}
        >
          <Link
            href={page * 20 >= total ? "#" : next}
            aria-disabled={page * 20 >= total}
            tabIndex={page * 20 >= total ? -1 : undefined}
            className={
              page * 20 >= total ? "pointer-events-none opacity-50" : ""
            }
          >
            下一页
          </Link>
        </Button>
      </div>
    </div>
  );
}
