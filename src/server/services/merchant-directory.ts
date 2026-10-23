import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { HttpError, type SessionUser } from "../../lib/auth";
import { monthStart } from "./tenants";

export async function listMerchantDirectory(
  user: SessionUser,
  input: { search: string; status: string; page: number },
) {
  if (user.role !== "ADMIN") throw new HttpError(403, "需要平台管理员权限");
  const search = input.search.trim().slice(0, 120);
  const now = new Date();
  const where: Prisma.TenantWhereInput = {
    AND: [
      search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
              { contactEmail: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      input.status === "EXPIRED"
        ? { status: "ACTIVE", expiresAt: { lte: now } }
        : input.status === "ACTIVE"
          ? {
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            }
          : ["PENDING", "SUSPENDED"].includes(input.status)
            ? { status: input.status }
            : {},
    ],
  };
  const pageSize = 20;
  const total = await prisma.tenant.count({ where });
  const page = Math.min(
    Math.max(1, Math.min(100000, Number(input.page) || 1)) | 0,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const tenants = await prisma.tenant.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
  const ids = tenants.map((tenant) => tenant.id);
  // One grouped statement replaces four round trips per merchant and reads one snapshot.
  const usages = ids.length
    ? await prisma.$queryRaw<
        {
          id: string;
          agents: bigint;
          sites: bigint;
          conversations: bigint;
          storageBytes: bigint;
        }[]
      >(Prisma.sql`
    WITH agents AS (SELECT "tenantId", COUNT(*) AS n FROM "User" WHERE "tenantId" = ANY(${ids}::text[]) AND active AND role <> 'ADMIN' GROUP BY "tenantId"),
    sites AS (SELECT "tenantId", COUNT(*) AS n FROM "Site" WHERE "tenantId" = ANY(${ids}::text[]) GROUP BY "tenantId"),
    conversations AS (SELECT s."tenantId", COUNT(*) AS n FROM "Conversation" c JOIN "Site" s ON s.id=c."siteId" WHERE s."tenantId" = ANY(${ids}::text[]) AND c."createdAt" >= ${monthStart(now)} GROUP BY s."tenantId"),
    storage AS (SELECT s."tenantId", SUM(a.size) AS n FROM "Attachment" a JOIN "Site" s ON s.id=a."siteId" WHERE s."tenantId" = ANY(${ids}::text[]) GROUP BY s."tenantId")
    SELECT t.id, COALESCE(a.n,0) AS agents, COALESCE(s.n,0) AS sites, COALESCE(c.n,0) AS conversations, COALESCE(f.n,0) AS "storageBytes"
    FROM "Tenant" t LEFT JOIN agents a ON a."tenantId"=t.id LEFT JOIN sites s ON s."tenantId"=t.id LEFT JOIN conversations c ON c."tenantId"=t.id LEFT JOIN storage f ON f."tenantId"=t.id WHERE t.id = ANY(${ids}::text[])
  `)
    : [];
  const byId = new Map(
    usages.map((row) => [
      row.id,
      {
        agents: Number(row.agents),
        sites: Number(row.sites),
        conversations: Number(row.conversations),
        storageBytes: Number(row.storageBytes),
      },
    ]),
  );
  return {
    total,
    page,
    pageSize,
    tenants: tenants.map((tenant) => ({
      ...tenant,
      usage: byId.get(tenant.id)!,
    })),
  };
}
