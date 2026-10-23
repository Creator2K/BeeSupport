import Link from "next/link";
import { ArrowRight, MessageSquare, Sparkles, Users } from "lucide-react";

import { PageHeader, StatCard } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminDb } from "@/lib/tenant-db";
import { adminUrl } from "@/lib/app-paths";
import { getServerT } from "@/lib/i18n/server";
import { formatDateTime, formatDuration } from "@/lib/format";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getOverviewStats } from "@/server/services/overview";
import { getOnboarding } from "@/server/services/onboarding";

export const metadata = { title: "概览" };

export default async function AdminOverviewPage() {
  const prisma = await adminDb();
  const admin = await requireAdmin();
  const { t } = await getServerT();
  const [stats, sitesActive, agentsActive, recent, onboarding] =
    await Promise.all([
      getOverviewStats(
        new Date(),
        admin.role === "ADMIN" ? undefined : admin.tenantId,
      ),
      prisma.site.count({ where: { active: true } }),
      prisma.user.count({
        where: {
          active: true,
          role: { in: ["ADMIN", "MERCHANT_ADMIN", "AGENT"] },
        },
      }),
      prisma.conversation.findMany({
        orderBy: { lastMessageAt: "desc" },
        take: 8,
        include: {
          site: { select: { name: true } },
          visitor: { select: { email: true, name: true } },
          assignedAgent: { select: { name: true } },
        },
      }),
      admin.role === "MERCHANT_ADMIN" ? getOnboarding(admin.tenantId) : null,
    ]);

  return (
    <div>
      <PageHeader
        title={t("overview.title")}
        description={t("overview.subtitle")}
      />
      {onboarding && !onboarding.complete && (
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
          <div>
            <h2 className="text-sm font-medium">继续完成站点接入</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              创建站点、完成试聊，并在你的网站安装嵌入代码。
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={adminUrl("/onboarding")}>
              打开接入向导 <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </section>
      )}
      <p className="text-muted-foreground -mt-3 mb-5 text-xs">
        {t("overview.reportingTimezone")}: {env.REPORT_TIMEZONE}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          className="animate-rise stagger-1"
          label={t("overview.totalConversations")}
          value={stats.totalConversations}
        />
        <StatCard
          className="animate-rise stagger-2"
          label={t("overview.pending")}
          value={stats.pending}
          hint={`${t("overview.open")} ${stats.open}`}
        />
        <StatCard
          className="animate-rise stagger-3"
          label={t("overview.closedToday")}
          value={stats.closedToday}
        />
        <StatCard
          className="animate-rise stagger-4"
          label={t("overview.avgFirstResponse")}
          value={
            stats.avgFirstResponseSeconds === null
              ? "—"
              : formatDuration(stats.avgFirstResponseSeconds, {
                  minute: t("overview.minute"),
                  second: t("overview.second"),
                })
          }
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          className="animate-rise stagger-5"
          label={t("overview.avgRating")}
          value={
            stats.averageRating === null ? "—" : stats.averageRating.toFixed(1)
          }
          hint={`${t("overview.ratingCount")} ${stats.ratingCount}`}
        />
        <StatCard
          className="animate-rise stagger-5"
          label={t("overview.sitesActive")}
          value={sitesActive}
        />
        <StatCard
          className="animate-rise stagger-6"
          label={t("overview.agentsActive")}
          value={agentsActive}
        />
        <StatCard
          className="animate-rise stagger-6"
          label={t("overview.title")}
          value="BeeSupport"
          hint={t("app.tagline")}
        />
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("overview.recent")}</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href={adminUrl("/conversations")}>
              {t("overview.viewAll")}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        {recent.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
            {t("overview.noData")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">
                    {t("conversations.visitor")}
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                    {t("common.site")}
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">
                    {t("conversations.assignedAgent")}
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    {t("common.status")}
                  </th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                    {t("conversations.lastMessage")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((conversation) => (
                  <tr key={conversation.id} className="border-t">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="text-muted-foreground size-3.5" />
                        <span className="truncate">
                          {conversation.visitor.name ??
                            conversation.visitor.email}
                        </span>
                        {conversation.unreadForAgent > 0 ? (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[10px]"
                          >
                            {conversation.unreadForAgent}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      {conversation.site.name}
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-2.5 md:table-cell">
                      {conversation.assignedAgent?.name ??
                        t("conversations.unassigned")}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={conversation.status} t={t} />
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-2.5 text-right text-xs whitespace-nowrap md:table-cell">
                      {formatDateTime(conversation.lastMessageAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-muted-foreground mt-6 flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {t("nav.agents")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          {t("nav.canned")}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: "PENDING" | "OPEN" | "CLOSED";
  t: (
    key:
      | "conversations.statusPending"
      | "conversations.statusOpen"
      | "conversations.statusClosed",
  ) => string;
}) {
  const map = {
    PENDING: {
      key: "conversations.statusPending" as const,
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
    OPEN: {
      key: "conversations.statusOpen" as const,
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    CLOSED: {
      key: "conversations.statusClosed" as const,
      className: "bg-muted text-muted-foreground",
    },
  };
  const item = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}
    >
      {t(item.key)}
    </span>
  );
}
