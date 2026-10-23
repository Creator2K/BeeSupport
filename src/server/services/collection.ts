import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { HttpError, type SessionUser } from "../../lib/auth";
import {
  COLLECTION_KEY,
  collectionSchema,
  readCollection,
} from "../../lib/collection";

export async function getCollectionSettings() {
  return readCollection(
    (await prisma.setting.findUnique({ where: { key: COLLECTION_KEY } }))
      ?.value,
  );
}
export async function saveCollectionSettings(
  user: SessionUser,
  input: unknown,
  revision: string,
) {
  if (user.role !== "ADMIN")
    throw new HttpError(403, "仅平台管理员可配置收款说明");
  const settings = collectionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:collection'))`;
    const current = await tx.setting.findUnique({
      where: { key: COLLECTION_KEY },
    });
    if (readCollection(current?.value).revision !== revision)
      throw new HttpError(409, "收款配置已更新，请刷新后重试");
    const next = { revision: randomUUID(), settings };
    await tx.setting.upsert({
      where: { key: COLLECTION_KEY },
      create: { key: COLLECTION_KEY, value: next },
      update: { value: next },
    });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: "subscription.collection.settings",
        targetType: "Setting",
        targetId: COLLECTION_KEY,
        meta: { enabled: settings.enabled },
      },
    });
    return next.revision;
  });
}
