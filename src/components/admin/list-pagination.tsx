import { Button } from "@/components/ui/button";

export function ListPagination({
  page,
  pageSize,
  total,
  basePath,
  filters,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  filters: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const url = (value: number) => {
    const params = new URLSearchParams(filters);
    params.set("page", String(value));
    return `${basePath}?${params}`;
  };
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        共 {total} 条 · 第 {page} / {pages} 页
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild size="sm" variant="outline">
            <a href={url(page - 1)}>上一页</a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            上一页
          </Button>
        )}
        {page < pages ? (
          <Button asChild size="sm" variant="outline">
            <a href={url(page + 1)}>下一页</a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            下一页
          </Button>
        )}
      </div>
    </div>
  );
}
