import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { cannedSearchSchema, type CannedSearch } from "../../lib/canned";
import { itemSelect, searchWhere, servingScope } from "./canned-scope";

export async function listCannedForAgent(
  actor: SessionUser,
  input: CannedSearch = {},
) {
  const data = cannedSearchSchema.parse(input);
  const scope = await servingScope(actor, data.siteId);
  const where = { AND: [scope, searchWhere(data)] };
  const [records, categories] = await Promise.all([
    prisma.cannedResponse.findMany({
      where,
      select: itemSelect,
      orderBy: [{ usageCount: "desc" }, { title: "asc" }, { id: "asc" }],
      take: 51,
    }),
    prisma.cannedResponse.findMany({
      where: { AND: [scope, { category: { not: "" } }] },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);
  return {
    items: records.slice(0, 50),
    categories: categories.map((row) => row.category),
    hasMore: records.length > 50,
  };
}

export async function recordCannedUse(
  actor: SessionUser,
  id: string,
  siteId: string,
) {
  const scope = await servingScope(actor, siteId);
  return prisma.$transaction(async (tx) => {
    const where = { AND: [scope, { id }] };
    const item = await tx.cannedResponse.findFirst({
      where,
      select: itemSelect,
    });
    if (!item) throw new HttpError(404, "话术已删除或不可用，请重新选择");
    const updated = await tx.cannedResponse.updateMany({
      where,
      data: { usageCount: { increment: 1 } },
    });
    if (!updated.count)
      throw new HttpError(404, "话术已删除或不可用，请重新选择");
    return item;
  });
}
