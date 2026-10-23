import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { PageHeader } from "@/components/admin/page-header";
import { formatDateTime } from "@/lib/format";
import { RiskClient } from "./risk-client";

export const metadata = { title: "风控管理" };
export const dynamic = "force-dynamic";

export default async function RiskPage({
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
  const page = Math.max(1, Math.min(100000, Number(read("page")) || 1)) | 0;
  const eventPage =
    Math.max(1, Math.min(100000, Number(read("eventPage")) || 1)) | 0;
  const where: Prisma.RiskRuleWhereInput = {
    ...(read("kind") === "IP" || read("kind") === "WORD"
      ? { kind: read("kind") }
      : {}),
    ...(read("siteId") ? { siteId: read("siteId") } : {}),
    ...(read("query")
      ? { value: { contains: read("query"), mode: "insensitive" } }
      : {}),
  };
  const eventWhere = read("siteId") ? { siteId: read("siteId") } : {};
  const [rules, total, events, eventTotal, sites, active, recent] =
    await Promise.all([
      prisma.riskRule.findMany({
        where,
        include: { site: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.riskRule.count({ where }),
      prisma.riskEvent.findMany({
        where: eventWhere,
        include: { site: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (eventPage - 1) * 20,
        take: 20,
      }),
      prisma.riskEvent.count({ where: eventWhere }),
      prisma.site.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.riskRule.count({
        where: {
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
      prisma.riskEvent.count({
        where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
      }),
    ]);
  return (
    <div className="min-w-0">
      <PageHeader
        title="风控管理"
        description="管理违禁词、IP 封禁和访客访问风险。规则修改后立即用于新请求。"
      />
      <RiskClient
        basePath={`${ADMIN_PATH}/risk`}
        sites={sites}
        total={total}
        eventTotal={eventTotal}
        page={page}
        eventPage={eventPage}
        activeCount={active}
        recentCount={recent}
        filters={{
          kind: read("kind"),
          siteId: read("siteId"),
          query: read("query"),
        }}
        initialIp={read("ip")}
        initialSiteId={read("targetSite")}
        rules={rules.map((rule) => ({
          ...rule,
          siteName: rule.site?.name ?? "全部站点",
          site: undefined,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
          expiresAt: rule.expiresAt?.toISOString() ?? null,
          expiryLabel: formatDateTime(rule.expiresAt),
          expired: Boolean(rule.expiresAt && rule.expiresAt <= new Date()),
        }))}
        events={events.map((event) => ({
          ...event,
          siteName: event.site?.name ?? "—",
          site: undefined,
          createdAt: event.createdAt.toISOString(),
          createdLabel: formatDateTime(event.createdAt),
        }))}
      />
    </div>
  );
}
