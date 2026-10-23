import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { HttpError, type SessionUser } from "../../lib/auth";
import { operationWindow } from "../../lib/operations";
export async function getOperations(
  user: SessionUser,
  days = 30,
  now = new Date(),
  tenantIds?: string[],
) {
  if (user.role !== "ADMIN")
    throw new HttpError(403, "仅平台管理员可查看运营数据");
  const window = operationWindow(days, now);
  const utc = (date: Date) =>
    Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const start = utc(window.start),
    end = utc(window.end),
    instant = utc(now),
    soon = utc(new Date(now.getTime() + 7 * 86400000)),
    recent = utc(new Date(now.getTime() - 7 * 86400000));
  const scope = Prisma.sql`t.id <> 'legacy' ${tenantIds ? Prisma.sql`AND t.id = ANY(${tenantIds}::text[])` : Prisma.empty}`;
  const [summaryRows, trendRows, expiring] = await prisma.$transaction(
    [
      prisma.$queryRaw<Record<string, bigint | number>[]>(Prisma.sql`
      WITH tenants AS (SELECT t.* FROM "Tenant" t WHERE ${scope}),
      orders AS (SELECT o.* FROM "SubscriptionOrder" o JOIN tenants t ON t.id=o."tenantId"),
      payers AS (SELECT "tenantId", COUNT(*) AS n, BOOL_OR("reviewedAt" >= ${start}) AS recent FROM orders WHERE status='CONFIRMED' AND "reviewedAt" <= ${end} GROUP BY "tenantId")
      SELECT
        (SELECT COUNT(*) FROM tenants) AS total,
        (SELECT COUNT(*) FROM tenants WHERE status='ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt">${instant})) AS serving,
        (SELECT COUNT(*) FROM tenants WHERE status='PENDING') AS pending,
        (SELECT COUNT(*) FROM tenants WHERE status='SUSPENDED') AS suspended,
        (SELECT COUNT(*) FROM tenants WHERE status='ACTIVE' AND "expiresAt"<=${instant}) AS expired,
        (SELECT COUNT(*) FROM tenants WHERE status='ACTIVE' AND "expiresAt">${instant} AND "expiresAt"<=${soon}) AS expiring,
        (SELECT COUNT(*) FROM tenants WHERE "createdAt">=${start} AND "createdAt"<=${end}) AS applicants,
        (SELECT COUNT(*) FROM tenants WHERE status='ACTIVE' AND "createdAt">=${start} AND "createdAt"<=${end}) AS activated,
        (SELECT COUNT(*) FROM tenants t WHERE t.status='ACTIVE' AND EXISTS(SELECT 1 FROM "Site" s WHERE s."tenantId"=t.id AND s.active AND s."embedSeenAt" IS NOT NULL)) AS installed,
        (SELECT COUNT(*) FROM tenants t WHERE t.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM "Conversation" c JOIN "Site" s ON s.id=c."siteId" WHERE s."tenantId"=t.id AND c."lastMessageAt">=${recent})) AS inactive,
        (SELECT COALESCE(SUM("priceCents"),0) FROM orders WHERE status='CONFIRMED' AND "reviewedAt">=${start} AND "reviewedAt"<=${end}) AS "revenueCents",
        (SELECT COUNT(*) FROM orders WHERE status='CONFIRMED' AND "reviewedAt">=${start} AND "reviewedAt"<=${end}) AS confirmed,
        (SELECT COUNT(*) FROM orders WHERE status='PENDING' AND "validUntil">${instant}) AS "pendingOrders",
        (SELECT COUNT(*) FROM orders WHERE status='PENDING' AND "validUntil">${instant} AND "paymentReportedAt" IS NOT NULL) AS "reportedOrders",
        (SELECT COUNT(*) FROM payers WHERE recent) AS buyers,
        (SELECT COUNT(*) FROM payers WHERE recent AND n>1) AS "repeatBuyers"
    `),
      prisma.$queryRaw<
        { day: string; applicants: bigint; revenueCents: bigint }[]
      >(Prisma.sql`
      WITH tenants AS (SELECT t.* FROM "Tenant" t WHERE ${scope}),
      applications AS (SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date::text AS day,COUNT(*) AS n FROM tenants WHERE "createdAt">=${start} AND "createdAt"<=${end} GROUP BY day),
      revenue AS (SELECT (o."reviewedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date::text AS day,SUM(o."priceCents") AS n FROM "SubscriptionOrder" o JOIN tenants t ON t.id=o."tenantId" WHERE o.status='CONFIRMED' AND o."reviewedAt">=${start} AND o."reviewedAt"<=${end} GROUP BY day)
      SELECT COALESCE(a.day,r.day) AS day,COALESCE(a.n,0) AS applicants,COALESCE(r.n,0) AS "revenueCents" FROM applications a FULL JOIN revenue r ON r.day=a.day ORDER BY day
    `),
      prisma.tenant.findMany({
        where: {
          id: { not: "legacy", ...(tenantIds ? { in: tenantIds } : {}) },
          status: "ACTIVE",
          expiresAt: { gt: now, lte: new Date(now.getTime() + 7 * 86400000) },
        },
        select: { id: true, name: true, slug: true, expiresAt: true },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: 10,
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const summary = Object.fromEntries(
    Object.entries(summaryRows[0]).map(([key, value]) => [key, Number(value)]),
  );
  const byDay = new Map(trendRows.map((row) => [row.day, row]));
  return {
    summary,
    trend: window.labels.map((day) => ({
      day,
      applicants: Number(byDay.get(day)?.applicants ?? 0),
      revenueCents: Number(byDay.get(day)?.revenueCents ?? 0),
    })),
    expiring: expiring.map((row) => ({
      ...row,
      expiresAt: row.expiresAt!.toISOString(),
    })),
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    days: window.days,
  };
}
