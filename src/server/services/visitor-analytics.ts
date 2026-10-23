import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { assertTenantFeature } from "./entitlements";

type TotalsRow = {
  visitors: bigint;
  visits: bigint;
  views: bigint;
  returning: bigint;
  consulted: bigint;
  active7: bigint;
  blocked: bigint;
};
type GroupRow = { label: string; count: bigint };
export type VisitorAnalytics = {
  totals: Record<keyof TotalsRow, number>;
  trend: { day: string; count: number }[];
  devices: { label: string; count: number }[];
  browsers: { label: string; count: number }[];
  systems: { label: string; count: number }[];
  languages: { label: string; count: number }[];
  sources: { label: string; count: number }[];
  tags: { label: string; count: number }[];
  sites: {
    id: string;
    name: string;
    visitors: number;
    visits: number;
    views: number;
    consulted: number;
  }[];
};

/** Demographics use the complete visitor cohort, never a paginated list or fabricated attributes. */
export async function getVisitorAnalytics(
  siteId?: string,
  days = 30,
  now = new Date(),
  tenantId?: string,
): Promise<VisitorAnalytics> {
  if (tenantId) await assertTenantFeature(tenantId, "advancedAnalytics");
  days = [7, 30, 90].includes(days) ? days : 30;
  const scope = Prisma.sql`${siteId ? Prisma.sql`v."siteId" = ${siteId}` : Prisma.sql`TRUE`} AND ${tenantId ? Prisma.sql`v."siteId" IN (SELECT id FROM "Site" WHERE "tenantId" = ${tenantId})` : Prisma.sql`TRUE`}`;
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const end = new Date(
    new Date(`${today}T00:00:00+08:00`).getTime() + 86400000,
  );
  const start = new Date(end.getTime() - days * 86400000);
  const group = (expression: Prisma.Sql, top = 8) =>
    prisma.$queryRaw<GroupRow[]>(Prisma.sql`
    SELECT ${expression} AS label, COUNT(*) AS count FROM "Visitor" v WHERE ${scope}
    GROUP BY label ORDER BY count DESC, label LIMIT ${top}`);
  const device = Prisma.sql`CASE
    WHEN COALESCE(v.meta->>'device','') ~* '(手机|mobile|iphone|android)' THEN '手机'
    WHEN COALESCE(v.meta->>'device','') ~* '(平板|tablet|ipad)' THEN '平板'
    WHEN COALESCE(v.meta->>'device','') ~* '(桌面|desktop)' THEN '电脑'
    WHEN COALESCE(v.meta->>'device','') = '' THEN '未知设备' ELSE '其他设备' END`;
  const system = Prisma.sql`CASE
    WHEN COALESCE(v.meta->>'os','') ~* 'android' THEN 'Android'
    WHEN COALESCE(v.meta->>'os','') ~* '(ios|ipados)' THEN 'iOS / iPadOS'
    WHEN COALESCE(v.meta->>'os','') ~* 'windows' THEN 'Windows'
    WHEN COALESCE(v.meta->>'os','') ~* '(macos|mac os)' THEN 'macOS'
    WHEN COALESCE(v.meta->>'os','') ~* 'harmony' THEN 'HarmonyOS'
    WHEN COALESCE(v.meta->>'os','') ~* 'linux' THEN 'Linux'
    WHEN COALESCE(v.meta->>'os','') = '' THEN '未知系统' ELSE '其他系统' END`;
  const [
    totals,
    trend,
    devices,
    browsers,
    systems,
    languages,
    sources,
    tags,
    sites,
  ] = await Promise.all([
    prisma.$queryRaw<
      TotalsRow[]
    >(Prisma.sql`SELECT COUNT(*) AS visitors, COALESCE(SUM(v."visitCount"),0) AS visits, COALESCE(SUM(v."pageViews"),0) AS views,
      COUNT(*) FILTER (WHERE v."visitCount" > 1) AS returning,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Conversation" c WHERE c."visitorId" = v.id)) AS consulted,
      COUNT(*) FILTER (WHERE v."lastSeenAt" >= ${new Date(now.getTime() - 7 * 86400000)}) AS active7,
      COUNT(*) FILTER (WHERE v.blocked) AS blocked FROM "Visitor" v WHERE ${scope}`),
    prisma.$queryRaw<
      { day: string; count: bigint }[]
    >(Prisma.sql`SELECT (v."firstSeenAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date::text AS day, COUNT(*) AS count
      FROM "Visitor" v WHERE ${scope} AND v."firstSeenAt" >= ${start} AND v."firstSeenAt" < ${end} GROUP BY day ORDER BY day`),
    group(device),
    group(
      Prisma.sql`COALESCE(NULLIF(regexp_replace(v.meta->>'browser', ' [0-9].*$', ''),''),'未知浏览器')`,
    ),
    group(system),
    group(
      Prisma.sql`COALESCE(NULLIF(lower(split_part(replace(v.meta->>'locale','_','-'),'-',1)),''),'未知语言')`,
    ),
    group(
      Prisma.sql`COALESCE(NULLIF(lower(substring(v.referrer from '^https?://([^/?#]+)')),''),'直接访问 / 未知来源')`,
    ),
    prisma.$queryRaw<GroupRow[]>(
      Prisma.sql`SELECT tag AS label, COUNT(DISTINCT v.id) AS count FROM "Visitor" v CROSS JOIN LATERAL unnest(v."profileTags") tag WHERE ${scope} GROUP BY tag ORDER BY count DESC, tag LIMIT 8`,
    ),
    prisma.$queryRaw<
      {
        id: string;
        name: string;
        visitors: bigint;
        visits: bigint;
        views: bigint;
        consulted: bigint;
      }[]
    >(Prisma.sql`SELECT s.id, s.name, COUNT(*) AS visitors, SUM(v."visitCount") AS visits, SUM(v."pageViews") AS views,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Conversation" c WHERE c."visitorId" = v.id)) AS consulted
      FROM "Visitor" v JOIN "Site" s ON s.id = v."siteId" WHERE ${scope} GROUP BY s.id, s.name ORDER BY visitors DESC, s.name LIMIT 20`),
  ]);
  const counts = new Map(trend.map((row) => [row.day, Number(row.count)]));
  const normalize = (rows: GroupRow[]) =>
    rows.map((row) => ({ label: row.label, count: Number(row.count) }));
  const languagesMap: Record<string, string> = {
    zh: "中文",
    en: "英语",
    ja: "日语",
    ko: "韩语",
    ru: "俄语",
    es: "西班牙语",
    de: "德语",
    fr: "法语",
  };
  return {
    totals: Object.fromEntries(
      Object.entries(totals[0]!).map(([key, value]) => [key, Number(value)]),
    ) as VisitorAnalytics["totals"],
    trend: Array.from({ length: days }, (_, index) => {
      const day = new Date(start.getTime() + index * 86400000 + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      return { day, count: counts.get(day) ?? 0 };
    }),
    devices: normalize(devices),
    browsers: normalize(browsers),
    systems: normalize(systems),
    languages: normalize(languages).map((row) => ({
      ...row,
      label: languagesMap[row.label] || row.label,
    })),
    sources: normalize(sources),
    tags: normalize(tags),
    sites: sites.map((row) => ({
      ...row,
      visitors: Number(row.visitors),
      visits: Number(row.visits),
      views: Number(row.views),
      consulted: Number(row.consulted),
    })),
  };
}
