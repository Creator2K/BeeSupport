import type { Prisma } from "@prisma/client";

import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { cannedKeyword, cannedSearchSchema } from "../../lib/canned";

export function manager(actor: SessionUser) {
  if (
    !actor.tenantId ||
    (actor.role !== "ADMIN" && actor.role !== "MERCHANT_ADMIN")
  )
    throw new HttpError(403, "仅管理员可管理话术");
}

export function visible(actor: SessionUser): Prisma.CannedResponseWhereInput {
  if (!actor.tenantId) throw new HttpError(403, "账号归属无效");
  return {
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    OR: [{ shared: true }, { ownerId: actor.id }],
  };
}

export function searchWhere(
  input: ReturnType<typeof cannedSearchSchema.parse>,
): Prisma.CannedResponseWhereInput {
  const keyword = cannedKeyword(input.query);
  return {
    AND: [
      input.category ? { category: input.category } : {},
      input.visibility ? { shared: input.visibility === "shared" } : {},
      keyword
        ? {
            OR: ["title", "content", "shortcut", "category"].map((key) => ({
              [key]: { contains: keyword, mode: "insensitive" },
            })),
          }
        : {},
    ],
  };
}

export const itemSelect = {
  id: true,
  title: true,
  content: true,
  shortcut: true,
  category: true,
  siteId: true,
  usageCount: true,
  shared: true,
} satisfies Prisma.CannedResponseSelect;

/** Site context supplies the tenant, including when platform staff are assisting another merchant. */
export async function servingScope(
  actor: SessionUser,
  siteId?: string,
  db = prisma,
): Promise<Prisma.CannedResponseWhereInput> {
  visible(actor);
  if (siteId) {
    const site = await db.site.findFirst({
      where: {
        id: siteId,
        ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
        ...(actor.siteIds === null
          ? {}
          : { id: { in: actor.siteIds, equals: siteId } }),
      },
      select: { tenantId: true },
    });
    if (!site) throw new HttpError(403, "无权使用该站点的话术");
    return {
      AND: [
        visible(actor),
        { tenantId: site.tenantId },
        { OR: [{ siteId: null }, { siteId }] },
      ],
    };
  }
  return {
    AND: [
      visible(actor),
      { tenantId: actor.tenantId },
      actor.siteIds === null
        ? {}
        : { OR: [{ siteId: null }, { siteId: { in: actor.siteIds } }] },
    ],
  };
}
