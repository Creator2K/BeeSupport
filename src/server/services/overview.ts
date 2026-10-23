import { prisma } from "../../lib/db";
import { env } from "../../lib/env";

export type OverviewStats = {
  totalConversations: number;
  pending: number;
  open: number;
  closedToday: number;
  averageRating: number | null;
  ratingCount: number;
  avgFirstResponseSeconds: number | null;
};

/** Aggregate the entire reporting window without transferring conversation history to Node. */
export async function getOverviewStats(
  now = new Date(),
  tenantId?: string,
): Promise<OverviewStats> {
  const until = now.toISOString();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const zone = env.REPORT_TIMEZONE;
  // Prisma DateTime columns contain UTC timestamps without a PostgreSQL time zone.
  // Convert explicit ISO instants to UTC, so the connection's TimeZone cannot shift the window.
  const [stats] = await prisma.$queryRaw<OverviewStats[]>`
    WITH bounds AS (
      SELECT
        ${since}::timestamptz AT TIME ZONE 'UTC' AS window_start,
        ${until}::timestamptz AT TIME ZONE 'UTC' AS window_end,
        date_trunc('day', ${until}::timestamptz, ${zone}) AT TIME ZONE 'UTC' AS today_start
    ), scoped AS (
      SELECT c."status", c."rating", c."createdAt", c."firstResponseAt",
        c."createdAt" >= b.window_start AND c."createdAt" <= b.window_end AS recent,
        c."closedAt" >= b.today_start AND c."closedAt" <= b.window_end AS closed_today,
        c."firstResponseAt" <= b.window_end AS responded
      FROM "Conversation" c CROSS JOIN bounds b
      WHERE (${tenantId ?? null}::text IS NULL OR c."siteId" IN (SELECT id FROM "Site" WHERE "tenantId" = ${tenantId ?? null}))
    )
    SELECT
      (COUNT(*) FILTER (WHERE recent))::integer AS "totalConversations",
      (COUNT(*) FILTER (WHERE "status" = 'PENDING'))::integer AS pending,
      (COUNT(*) FILTER (WHERE "status" = 'OPEN'))::integer AS open,
      (COUNT(*) FILTER (WHERE "status" = 'CLOSED' AND closed_today))::integer AS "closedToday",
      (AVG("rating") FILTER (WHERE recent))::double precision AS "averageRating",
      (COUNT("rating") FILTER (WHERE recent))::integer AS "ratingCount",
      (AVG(GREATEST(0, EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt"))))
        FILTER (WHERE recent AND responded))::double precision AS "avgFirstResponseSeconds"
    FROM scoped
  `;
  if (!stats) throw new Error("概览统计查询没有返回结果");
  return stats;
}
