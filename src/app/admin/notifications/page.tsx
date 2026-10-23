import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { visibleNoticeWhere } from "@/server/services/account-notices";
import { NoticeButtons } from "./notice-buttons";
import { ListPagination } from "@/components/admin/list-pagination";
export const dynamic = "force-dynamic";
export const metadata = { title: "通知中心" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdmin(),
    params = await searchParams,
    where = await visibleNoticeWhere(user),
    pageSize = 20;
  const total = await prisma.accountNotice.count({ where }),
    page = Math.min(
      Math.max(1, Math.min(100000, Number(params.page) || 1)) | 0,
      Math.max(1, Math.ceil(total / pageSize)),
    );
  const notices = await prisma.accountNotice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="通知中心"
        description="查看订单审核结果和服务到期提醒。服务续期后，旧有效期的提醒不再展示。"
      />
      <div className="flex flex-wrap justify-between gap-3">
        <p className="text-sm text-muted-foreground">共 {total} 条通知</p>
        <NoticeButtons />
      </div>
      {notices.length ? (
        <div className="space-y-3">
          {notices.map((notice) => (
            <article
              key={notice.id}
              className={`space-y-3 rounded-xl border p-4 sm:p-5 ${notice.readAt ? "" : "border-primary/40 bg-muted/20"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium">
                  {notice.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {notice.readAt ? "已读" : "未读"}
                  </span>
                </h2>
                <time className="text-xs text-muted-foreground">
                  {notice.createdAt.toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                  （北京时间）
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                {notice.body}
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href={`${ADMIN_PATH}/subscription`}
                  className="text-sm underline"
                >
                  查看套餐与续费
                </Link>
                {!notice.readAt && <NoticeButtons id={notice.id} />}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          暂无通知
        </p>
      )}
      <ListPagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={`${ADMIN_PATH}/notifications`}
        filters={{}}
      />
    </div>
  );
}
