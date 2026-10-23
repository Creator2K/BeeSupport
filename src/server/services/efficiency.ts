import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { efficiencyFilters, type EfficiencyData } from "../../lib/efficiency";

function scope(actor: SessionUser): Prisma.SiteWhereInput {
  if (!actor.tenantId || !["ADMIN", "MERCHANT_ADMIN"].includes(actor.role))
    throw new HttpError(403, "需要管理员权限");
  return {
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(actor.siteIds === null ? {} : { id: { in: actor.siteIds } }),
  };
}

export async function getEfficiencyOptions(actor: SessionUser, siteId = "") {
  const where = scope(actor);
  const sites = await prisma.site.findMany({
    where,
    select: {
      id: true,
      name: true,
      tenantId: true,
      tenant: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const selected = siteId ? sites.find((site) => site.id === siteId) : null;
  if (siteId && !selected) throw new HttpError(404, "站点不存在或无权访问");
  const agents = await prisma.user.findMany({
    where: {
      ...(selected
        ? { tenantId: selected.tenantId }
        : actor.role === "ADMIN"
          ? {}
          : { tenantId: actor.tenantId }),
      ...(actor.siteIds === null
        ? {}
        : { tenant: { sites: { some: { id: { in: actor.siteIds } } } } }),
    },
    select: {
      id: true,
      name: true,
      active: true,
      tenantId: true,
      tenant: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return {
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      tenantId: site.tenantId,
      tenantName: actor.role === "ADMIN" ? site.tenant.name : null,
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      active: agent.active,
      tenantId: agent.tenantId,
      tenantName: actor.role === "ADMIN" ? agent.tenant.name : null,
    })),
  };
}

export async function getEfficiency(
  actor: SessionUser,
  input: unknown,
  now = new Date(),
): Promise<EfficiencyData> {
  const siteWhere = scope(actor);
  let parsed;
  try {
    parsed = efficiencyFilters(input, now);
  } catch (error) {
    if (error instanceof Error && error.name !== "ZodError")
      throw new HttpError(400, error.message);
    throw error;
  }
  const { filters, range } = parsed;
  const selectedSite = filters.siteId
    ? await prisma.site.findFirst({
        where: { AND: [siteWhere, { id: filters.siteId }] },
        select: { tenantId: true },
      })
    : null;
  if (filters.siteId && !selectedSite)
    throw new HttpError(404, "站点不存在或无权访问");
  if (filters.agentId && filters.agentId !== "unassigned") {
    const agent = await prisma.user.findFirst({
      where: {
        id: filters.agentId,
        ...(selectedSite
          ? { tenantId: selectedSite.tenantId }
          : actor.role === "ADMIN"
            ? {}
            : { tenantId: actor.tenantId }),
      },
      select: { id: true },
    });
    if (!agent) throw new HttpError(404, "客服不存在或不属于所选范围");
  }
  const instant = (date: Date) =>
    Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const start = instant(range.gte),
    end = instant(range.lt),
    asOf = instant(now);
  const siteScope = Prisma.sql`
    ${actor.role === "ADMIN" ? Prisma.sql`TRUE` : Prisma.sql`s."tenantId" = ${actor.tenantId}`}
    ${actor.siteIds === null ? Prisma.empty : actor.siteIds.length ? Prisma.sql`AND s.id IN (${Prisma.join(actor.siteIds)})` : Prisma.sql`AND FALSE`}
    ${filters.siteId ? Prisma.sql`AND s.id = ${filters.siteId}` : Prisma.empty}
  `;
  const aggregate = Prisma.sql`
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
    COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
    COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
    COUNT(*) FILTER (WHERE waiting_since IS NOT NULL)::int AS waiting,
    COUNT(response_seconds)::int AS "responseSamples",
    AVG(response_seconds)::double precision AS "avgResponseSeconds",
    (percentile_cont(0.9) WITHIN GROUP (ORDER BY response_seconds))::double precision AS "p90ResponseSeconds",
    COUNT(close_seconds)::int AS "closeSamples",
    AVG(close_seconds)::double precision AS "avgCloseSeconds",
    COUNT(valid_rating)::int AS "ratingSamples", AVG(valid_rating)::double precision AS "avgRating",
    COUNT(*) FILTER (WHERE valid_rating >= 4)::int AS satisfied
  `;
  type Row = Omit<EfficiencyData, "filters" | "asOf">;
  const rows = await prisma.$queryRaw<{ data: Row }[]>(Prisma.sql`
    WITH cohort AS MATERIALIZED (
      SELECT c.*, s.name AS site_name, t.name AS tenant_name,
        u.id AS agent_id, u.name AS agent_name, u.active AS agent_active,
        CASE WHEN c."firstResponseAt" >= c."createdAt" AND c."firstResponseAt" <= ${asOf} THEN c."firstResponseAt" END AS stored_response
      FROM "Conversation" c JOIN "Site" s ON s.id = c."siteId" JOIN "Tenant" t ON t.id = s."tenantId"
      LEFT JOIN "User" u ON u.id = c."assignedAgentId" AND u."tenantId" = s."tenantId"
      WHERE ${siteScope} AND c."createdAt" >= ${start} AND c."createdAt" < ${end} AND c."createdAt" <= ${asOf}
        ${!filters.agentId ? Prisma.empty : filters.agentId === "unassigned" ? Prisma.sql`AND u.id IS NULL` : Prisma.sql`AND u.id = ${filters.agentId}`}
    ), message_times AS (
      SELECT m."conversationId",
        MIN(m."createdAt") FILTER (WHERE m.sender = 'AGENT') AS first_agent,
        MAX(m."createdAt") FILTER (WHERE m.sender = 'AGENT') AS last_agent
      FROM "Message" m JOIN cohort c ON c.id = m."conversationId"
      WHERE m.type IN ('TEXT','IMAGE','FILE') AND m.sender = 'AGENT' AND m."createdAt" >= c."createdAt" AND m."createdAt" <= ${asOf}
      GROUP BY m."conversationId"
    ), metrics AS MATERIALIZED (
      SELECT c.id, c.status, c."siteId", c.site_name, c.tenant_name, c.agent_id, c.agent_name, c.agent_active,
        (c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date::text AS day,
        EXTRACT(EPOCH FROM (COALESCE(c.stored_response, p.first_agent) - c."createdAt"))::double precision AS response_seconds,
        CASE WHEN c.status = 'CLOSED' AND c."closedAt" >= c."createdAt" AND c."closedAt" <= ${asOf} THEN EXTRACT(EPOCH FROM (c."closedAt" - c."createdAt"))::double precision END AS close_seconds,
        CASE WHEN c.rating BETWEEN 1 AND 5 AND (c."ratedAt" IS NULL OR c."ratedAt" <= ${asOf}) THEN c.rating END AS valid_rating,
        CASE WHEN c.status IN ('PENDING','OPEN') THEN COALESCE(
          CASE WHEN c."waitingSince" >= c."createdAt" AND c."waitingSince" <= ${asOf} THEN c."waitingSince" END,
          (SELECT MIN(v."createdAt") FROM "Message" v WHERE v."conversationId" = c.id AND v.sender = 'VISITOR' AND v.type IN ('TEXT','IMAGE','FILE')
            AND v."createdAt" >= c."createdAt" AND v."createdAt" <= ${asOf}
            AND (GREATEST(c.stored_response, p.last_agent) IS NULL OR v."createdAt" > GREATEST(c.stored_response, p.last_agent)))
        ) END AS waiting_since
      FROM cohort c LEFT JOIN message_times p ON p."conversationId" = c.id
    ), summary AS (SELECT ${aggregate} FROM metrics),
    by_site AS (SELECT "siteId" AS id, site_name AS name, tenant_name AS "tenantName", NULL::boolean AS active, ${aggregate} FROM metrics GROUP BY "siteId", site_name, tenant_name),
    by_agent AS (SELECT agent_id AS id, COALESCE(agent_name, '未分配') AS name, CASE WHEN agent_id IS NULL THEN NULL ELSE tenant_name END AS "tenantName", agent_active AS active, ${aggregate} FROM metrics GROUP BY agent_id, agent_name, agent_active, CASE WHEN agent_id IS NULL THEN NULL ELSE tenant_name END),
    by_day AS (SELECT day, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE waiting_since IS NOT NULL)::int AS waiting, COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed FROM metrics GROUP BY day)
    SELECT jsonb_build_object(
      'summary', (SELECT to_jsonb(s) FROM summary s),
      'trend', COALESCE((SELECT jsonb_agg(d ORDER BY d.day) FROM by_day d), '[]'::jsonb),
      'sites', COALESCE((SELECT jsonb_agg(s ORDER BY s.total DESC, s.name, s.id) FROM (SELECT * FROM by_site ORDER BY total DESC, name, id LIMIT 20) s), '[]'::jsonb),
      'agents', COALESCE((SELECT jsonb_agg(a ORDER BY a.total DESC, a.name, a.id NULLS LAST) FROM (SELECT * FROM by_agent ORDER BY total DESC, name, id NULLS LAST LIMIT 20) a), '[]'::jsonb),
      'siteGroups', (SELECT COUNT(*) FROM by_site), 'agentGroups', (SELECT COUNT(*) FROM by_agent)
    ) AS data
  `);
  if (!rows[0]) throw new Error("效率统计查询没有返回结果");
  const byDay = new Map(rows[0].data.trend.map((row) => [row.day, row]));
  const trend = Array.from(
    {
      length: Math.round((range.lt.getTime() - range.gte.getTime()) / 86400000),
    },
    (_, index) => {
      const day = new Date(range.gte.getTime() + index * 86400000 + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      return byDay.get(day) ?? { day, total: 0, waiting: 0, closed: 0 };
    },
  );
  return { ...rows[0].data, trend, filters, asOf: now.toISOString() };
}
