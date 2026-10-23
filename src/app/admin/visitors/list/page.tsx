import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { adminDb } from "@/lib/tenant-db";
import { formatDateTime } from "@/lib/format";
import { describeVisitor } from "@/lib/visitor-env";

export const metadata = { title: "访客明细" };
export const dynamic = "force-dynamic";

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prisma = await adminDb();
  await requireAdmin();
  const params = await searchParams;
  const read = (key: string) =>
    typeof params[key] === "string"
      ? (params[key] as string).slice(0, 200)
      : "";
  const query = read("query").trim();
  const siteId = read("siteId");
  const blocked = read("blocked");
  const page = Math.max(1, Math.min(100000, Number(read("page")) || 1)) | 0;
  const where: Prisma.VisitorWhereInput = {
    ...(siteId ? { siteId } : {}),
    ...(blocked === "true"
      ? { blocked: true }
      : blocked === "false"
        ? { blocked: false }
        : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { profileTags: { has: query } },
            { meta: { path: ["ip"], equals: query } },
          ],
        }
      : {}),
  };
  const [visitors, total, sites, allCount, returning, blockedCount] =
    await Promise.all([
      prisma.visitor.findMany({
        where,
        include: {
          site: { select: { name: true } },
          _count: { select: { conversations: true } },
        },
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.visitor.count({ where }),
      prisma.site.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.visitor.count(),
      prisma.visitor.count({ where: { visitCount: { gt: 1 } } }),
      prisma.visitor.count({ where: { blocked: true } }),
    ]);
  const pageUrl = (next: number) =>
    `${ADMIN_PATH}/visitors/list?${new URLSearchParams({ query, siteId, blocked, page: String(next) })}`;
  return (
    <div className="min-w-0">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href={`${ADMIN_PATH}/visitors`}>返回整体画像</Link>
      </Button>
      <PageHeader
        title="访客明细"
        description="查看访客身份、访问行为、设备环境和历史咨询，统一维护标签与备注。"
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["累计访客", allCount],
          ["回访访客", returning],
          ["已封禁身份", blockedCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <form className="mb-4 flex flex-wrap gap-2">
          <Input
            name="query"
            defaultValue={query}
            placeholder="搜索姓名、邮箱、标签或完整 IP"
            aria-label="搜索访客"
            className="w-full sm:w-72"
          />
          <select
            name="siteId"
            aria-label="筛选站点"
            defaultValue={siteId}
            className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">全部站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <select
            name="blocked"
            aria-label="身份状态"
            defaultValue={blocked}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">全部状态</option>
            <option value="false">正常</option>
            <option value="true">已封禁</option>
          </select>
          <Button type="submit" variant="outline">
            筛选
          </Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                {[
                  "访客",
                  "站点 / 标签",
                  "设备 / IP",
                  "访问 / 咨询",
                  "最近活跃",
                  "",
                ].map((text, i) => (
                  <th key={i} className="px-2 py-3 font-medium">
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visitors.map((visitor) => {
                const meta = visitor.meta as Record<string, unknown> | null;
                const identity = describeVisitor(meta);
                return (
                  <tr key={visitor.id} className="border-b last:border-0">
                    <td className="max-w-52 px-2 py-4">
                      <Link
                        href={`${ADMIN_PATH}/visitors/${visitor.id}`}
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {visitor.name || visitor.email || "匿名访客"}
                      </Link>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {visitor.email || "未提供邮箱"}
                      </p>
                      {visitor.blocked && (
                        <span className="mt-1 inline-block text-xs text-destructive">
                          身份已封禁
                        </span>
                      )}
                    </td>
                    <td className="max-w-48 px-2 py-4">
                      <p className="truncate">{visitor.site.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {visitor.profileTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-4 text-xs">
                      <p>
                        {identity.device || "—"} · {identity.browser || "—"}
                      </p>
                      <p className="mt-1 font-mono text-muted-foreground">
                        {typeof meta?.ip === "string" ? meta.ip : "—"}
                      </p>
                    </td>
                    <td className="px-2 py-4 text-xs">
                      <p>
                        {visitor.visitCount} 次访问 · {visitor.pageViews} 次浏览
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {visitor._count.conversations} 次咨询
                      </p>
                    </td>
                    <td className="px-2 py-4 text-xs text-muted-foreground">
                      {formatDateTime(visitor.lastSeenAt)}
                    </td>
                    <td className="px-2 py-4">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${ADMIN_PATH}/visitors/${visitor.id}`}>
                          查看画像
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visitors.length && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              暂无符合条件的访客
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            共 {total} 位 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageUrl(page - 1)}>上一页</Link>
              </Button>
            )}
            {page * 20 < total && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageUrl(page + 1)}>下一页</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
