import { cache } from "react";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { HttpError, type SessionUser } from "../../lib/auth";
import {
  homeContentSchema,
  readHomeDocument,
} from "../../lib/homepage-validation";
import type { HomeContent, PublicHomePlan } from "../../lib/homepage-content";
export const HOME_DRAFT = "homepage.draft";
export const HOME_PUBLISHED = "homepage.published";

export const getPublishedHome = cache(
  async () =>
    readHomeDocument(
      (await prisma.setting.findUnique({ where: { key: HOME_PUBLISHED } }))
        ?.value,
    ).content,
);
export async function getHomeEditor() {
  const [draft, live] = await Promise.all([
    prisma.setting.findUnique({ where: { key: HOME_DRAFT } }),
    prisma.setting.findUnique({ where: { key: HOME_PUBLISHED } }),
  ]);
  const published = readHomeDocument(live?.value);
  const editable = draft
    ? readHomeDocument(draft.value)
    : { revision: "initial", content: published.content };
  return {
    ...editable,
    publishedRevision: published.revision,
    publishedAt: live?.updatedAt.toISOString() ?? null,
  };
}
export async function getPublicHomePlans(
  content: HomeContent,
): Promise<PublicHomePlan[]> {
  if (!content.sections.plans || !content.planIds.length) return [];
  const rows = await prisma.subscriptionPlan.findMany({
    where: { id: { in: content.planIds }, active: true },
    select: {
      id: true,
      name: true,
      description: true,
      priceCents: true,
      durationDays: true,
      maxAgents: true,
      maxSites: true,
      monthlyConversations: true,
      storageMB: true,
    },
  });
  return content.planIds.flatMap(
    (id) => rows.find((row) => row.id === id) ?? [],
  );
}
export async function saveHomeDraft(
  user: SessionUser,
  input: unknown,
  revision: string,
) {
  if (user.role !== "ADMIN") throw new HttpError(403, "仅平台管理员可配置首页");
  const content = homeContentSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:homepage'))`;
    const current = await tx.setting.findUnique({ where: { key: HOME_DRAFT } });
    if (readHomeDocument(current?.value).revision !== revision)
      throw new HttpError(409, "草稿已被其他管理员修改，请刷新后重试");
    const next = { revision: randomUUID(), content };
    await tx.setting.upsert({
      where: { key: HOME_DRAFT },
      create: { key: HOME_DRAFT, value: next },
      update: { value: next },
    });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: "homepage.draft.save",
        targetType: "Setting",
        targetId: HOME_DRAFT,
      },
    });
    return next.revision;
  });
}
export async function publishHome(
  user: SessionUser,
  revision: string,
  publishedRevision: string,
) {
  if (user.role !== "ADMIN") throw new HttpError(403, "仅平台管理员可发布首页");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:homepage'))`;
    const draft = await tx.setting.findUnique({ where: { key: HOME_DRAFT } });
    const live = await tx.setting.findUnique({
      where: { key: HOME_PUBLISHED },
    });
    const doc = readHomeDocument(draft?.value);
    if (
      !draft ||
      doc.revision !== revision ||
      readHomeDocument(live?.value).revision !== publishedRevision
    )
      throw new HttpError(409, "首页内容已更新，请刷新后再发布");
    if (
      doc.content.planIds.length &&
      (await tx.subscriptionPlan.count({
        where: { id: { in: doc.content.planIds }, active: true },
      })) !== doc.content.planIds.length
    )
      throw new HttpError(400, "选择的套餐已下架或不存在，请更新草稿后发布");
    const next = { revision: randomUUID(), content: doc.content };
    await tx.setting.upsert({
      where: { key: HOME_PUBLISHED },
      create: { key: HOME_PUBLISHED, value: next },
      update: { value: next },
    });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: "homepage.publish",
        targetType: "Setting",
        targetId: HOME_PUBLISHED,
        meta: { revision: next.revision },
      },
    });
    return next.revision;
  });
}
