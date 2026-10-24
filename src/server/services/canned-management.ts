import type { Prisma } from "@prisma/client";

import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  cannedInputSchema,
  cannedSearchSchema,
  type CannedInput,
  type CannedSearch,
} from "../../lib/canned";
import {
  itemSelect,
  manager,
  searchWhere,
  visible,
} from "./canned-scope";

export async function listManagedCanned(
  actor: SessionUser,
  input: CannedSearch = {},
  requestedPage = 1,
) {
  manager(actor);
  const data = cannedSearchSchema.parse(input);
  const scope = visible(actor);
  const where: Prisma.CannedResponseWhereInput = {
    AND: [scope, searchWhere(data), data.siteId ? { siteId: data.siteId } : {}],
  };
  const pageSize = 20;
  return prisma.$transaction(async (tx) => {
    const total = await tx.cannedResponse.count({ where });
    const page = Math.min(
      Math.max(1, Math.floor(Number(requestedPage) || 1)),
      Math.max(1, Math.ceil(total / pageSize)),
    );
    const [items, categories] = await Promise.all([
      tx.cannedResponse.findMany({
        where,
        orderBy: [{ category: "asc" }, { title: "asc" }, { id: "asc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          ...itemSelect,
          site: { select: { name: true } },
          owner: { select: { name: true } },
          tenant: { select: { name: true } },
        },
      }),
      tx.cannedResponse.findMany({
        where: { AND: [scope, { category: { not: "" } }] },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    ]);
    return {
      items,
      categories: categories.map((row) => row.category),
      total,
      page,
      pageSize,
    };
  });
}

export async function saveCannedReply(
  actor: SessionUser,
  input: CannedInput,
  id?: string,
) {
  manager(actor);
  const data = cannedInputSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const existing = id
      ? await tx.cannedResponse.findFirst({
          where: { AND: [visible(actor), { id }] },
          select: { tenantId: true },
        })
      : null;
    if (id && !existing) throw new HttpError(404, "话术不存在或无权编辑");
    const site = data.siteId
      ? await tx.site.findUnique({
          where: { id: data.siteId },
          select: { tenantId: true },
        })
      : null;
    if (data.siteId && !site) throw new HttpError(404, "站点不存在");
    const tenantId = existing?.tenantId ?? site?.tenantId ?? actor.tenantId;
    if (actor.role !== "ADMIN" && tenantId !== actor.tenantId)
      throw new HttpError(403, "无权访问该商家");
    if (site && site.tenantId !== tenantId)
      throw new HttpError(403, "不能将话术移动到其他商家");
    // Serialize shortcut checks with all management writes for this tenant.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    if (
      data.shortcut &&
      (await tx.cannedResponse.findFirst({
        where: {
          tenantId,
          siteId: data.siteId ?? null,
          shortcut: { equals: data.shortcut, mode: "insensitive" },
          ...(id ? { id: { not: id } } : {}),
        },
        select: { id: true },
      }))
    )
      throw new HttpError(409, "该范围内的快捷码已存在，请更换");
    const values = {
      title: data.title,
      content: data.content,
      category: data.category,
      shortcut: data.shortcut || null,
      siteId: data.siteId ?? null,
      shared: data.shared,
    };
    let item;
    if (id) {
      const updated = await tx.cannedResponse.updateMany({
        where: { AND: [visible(actor), { id, tenantId }] },
        data: values,
      });
      if (!updated.count) throw new HttpError(404, "话术不存在或无权编辑");
      item = { id };
    } else
      item = await tx.cannedResponse.create({
        data: { ...values, tenantId, ownerId: actor.id },
        select: { id: true },
      });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: id ? "canned.update" : "canned.create",
        targetType: "CannedResponse",
        targetId: item.id,
        meta: { category: data.category, shared: data.shared },
      },
    });
    return item;
  });
}

export async function deleteCannedReply(actor: SessionUser, id: string) {
  manager(actor);
  return prisma.$transaction(async (tx) => {
    const where = { AND: [visible(actor), { id }] };
    const item = await tx.cannedResponse.findFirst({
      where,
      select: { tenantId: true },
    });
    if (!item) throw new HttpError(404, "话术不存在或无权删除");
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${item.tenantId} FOR UPDATE`;
    const deleted = await tx.cannedResponse.deleteMany({ where });
    if (!deleted.count) throw new HttpError(404, "话术不存在或无权删除");
    await tx.auditLog.create({
      data: {
        tenantId: item.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "canned.delete",
        targetType: "CannedResponse",
        targetId: id,
      },
    });
  });
}
