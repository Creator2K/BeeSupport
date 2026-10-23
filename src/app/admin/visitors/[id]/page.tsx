import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldBan } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { adminDb } from "@/lib/tenant-db";
import { formatDateTime } from "@/lib/format";
import { describeVisitor } from "@/lib/visitor-env";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/admin/page-header";
import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "访客画像详情" };
export const dynamic = "force-dynamic";

export default async function VisitorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prisma = await adminDb();
  await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const page = Math.max(1, Math.min(100000, Number(query.page) || 1)) | 0;
  const visitor = await prisma.visitor.findUnique({
    where: { id },
    include: {
      site: { select: { name: true } },
      _count: { select: { conversations: true } },
    },
  });
  if (!visitor) notFound();
  const [conversations, riskCount] = await Promise.all([
    prisma.conversation.findMany({
      where: { visitorId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 20,
      take: 20,
      include: {
        assignedAgent: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.riskEvent.count({ where: { visitorId: id } }),
  ]);
  const meta = visitor.meta as Record<string, unknown> | null;
  const read = (key: string) =>
    typeof meta?.[key] === "string" || typeof meta?.[key] === "number"
      ? String(meta[key])
      : "—";
  const identity = describeVisitor(meta);
  return (
    <div className="min-w-0">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href={`${ADMIN_PATH}/visitors/list`}>
          <ArrowLeft className="size-4" />
          返回访客列表
        </Link>
      </Button>
      <PageHeader
        title={visitor.name || visitor.email || "匿名访客"}
        description={`${visitor.site.name} · ${visitor.email || "未提供邮箱"}`}
      />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["访问次数", visitor.visitCount],
              ["页面浏览", visitor.pageViews],
              ["历史咨询", visitor._count.conversations],
              ["拦截次数", riskCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">访问与设备</h2>
              {read("ip") !== "—" && (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`${ADMIN_PATH}/risk?${new URLSearchParams({ ip: read("ip"), targetSite: visitor.siteId })}`}
                  >
                    <ShieldBan className="size-4" />
                    封禁此 IP
                  </Link>
                </Button>
              )}
            </div>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {[
                ["首次访问", formatDateTime(visitor.firstSeenAt)],
                ["最近活跃", formatDateTime(visitor.lastSeenAt)],
                ["IP 地址", read("ip")],
                ["设备", identity.device || "—"],
                ["操作系统", identity.os || "—"],
                ["浏览器", identity.browser || "—"],
                ["语言", read("locale")],
                ["时区", read("timezone")],
                ["屏幕 / 视口", `${read("screen")} / ${read("viewport")}`],
                ["网络", read("connection")],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 space-y-4 border-t pt-5">
              {[
                ["首次落地页", visitor.landingPage],
                ["最近页面", visitor.lastPage],
                ["页面标题", visitor.lastPageTitle],
                ["来源页面", visitor.referrer],
                ["User-Agent", read("ua")],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 break-all text-sm">{value || "—"}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="min-w-0 rounded-xl border bg-card p-5">
            <h2 className="mb-4 font-medium">历史咨询</h2>
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/agent?c=${conversation.id}`}
                  className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {conversation.subject ||
                        conversation.lastMessagePreview ||
                        "未命名会话"}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {conversation.status === "CLOSED"
                        ? "已结束"
                        : conversation.status === "OPEN"
                          ? "进行中"
                          : "待接入"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(conversation.createdAt)} ·{" "}
                    {conversation._count.messages} 条消息 ·{" "}
                    {conversation.assignedAgent?.name || "未分配"}
                    {conversation.rating
                      ? ` · ${"★".repeat(conversation.rating)}`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {conversation.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
              {!conversations.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  暂无历史咨询
                </p>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                共 {visitor._count.conversations} 次咨询 · 第 {page} 页
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?page=${page - 1}`}>上一页</Link>
                  </Button>
                )}
                {page * 20 < visitor._count.conversations && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?page=${page + 1}`}>下一页</Link>
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
        <aside className="h-fit min-w-0 rounded-xl border bg-card p-5">
          <ProfileEditor
            key={visitor.id}
            visitor={{
              id: visitor.id,
              name: visitor.name,
              profileTags: visitor.profileTags,
              profileNote: visitor.profileNote,
              blocked: visitor.blocked,
            }}
          />
        </aside>
      </div>
    </div>
  );
}
