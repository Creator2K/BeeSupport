import type { Prisma } from "@prisma/client";
import { HttpError, canAccessSite, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { getIo } from "../../lib/realtime/emit";
import { rooms } from "../../lib/realtime/rooms";
import { deleteUpload } from "../../lib/storage";
import type { VisitorSession } from "../../lib/visitor-auth";

export type ImageGate = {
  enabled: boolean;
  pending: { id: string; sent: boolean; conversationId: string | null } | null;
};

export async function getImageGate(
  visitor: Pick<VisitorSession, "visitorId" | "siteId">,
): Promise<ImageGate> {
  const record = await prisma.visitor.findUnique({
    where: { id: visitor.visitorId },
    select: {
      siteId: true,
      pendingImageId: true,
      site: { select: { imageReviewEnabled: true } },
    },
  });
  if (!record || record.siteId !== visitor.siteId)
    throw new HttpError(404, "访客不存在");
  if (!record.site.imageReviewEnabled || !record.pendingImageId)
    return { enabled: record.site.imageReviewEnabled, pending: null };
  const image = await prisma.attachment.findUnique({
    where: { id: record.pendingImageId },
    select: {
      id: true,
      uploaderId: true,
      imageReviewState: true,
      message: { select: { conversationId: true } },
    },
  });
  return {
    enabled: true,
    pending:
      image?.uploaderId === visitor.visitorId &&
      image.imageReviewState === "PENDING"
        ? {
            id: image.id,
            sent: Boolean(image.message),
            conversationId: image.message?.conversationId ?? null,
          }
        : null,
  };
}

/** All image slot changes take the Visitor lock first, including message writes. */
export async function assertImageUploadSlot(
  tx: Prisma.TransactionClient,
  visitor: VisitorSession,
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${visitor.visitorId} FOR UPDATE`;
  const record = await tx.visitor.findUnique({
    where: { id: visitor.visitorId },
    select: {
      pendingImageId: true,
      site: { select: { imageReviewEnabled: true } },
    },
  });
  if (!record) throw new HttpError(404, "访客不存在");
  if (!record.site.imageReviewEnabled) return false;
  if (
    record.pendingImageId &&
    (await tx.attachment.findFirst({
      where: {
        id: record.pendingImageId,
        uploaderId: visitor.visitorId,
        imageReviewState: "PENDING",
      },
      select: { id: true },
    }))
  )
    throw new HttpError(409, "请等待客服允许后再发送下一张图片");
  return true;
}

export async function emitImageGate(
  visitorId: string,
  siteId: string,
  attachment?: { id: string; imageReviewState: string },
): Promise<void> {
  const gate = await getImageGate({ visitorId, siteId });
  const io = getIo();
  io?.to(rooms.visitor(visitorId)).emit("image:gate", gate);
  if (attachment) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { tenantId: true },
    });
    io?.to([
      rooms.siteAgents(siteId),
      rooms.tenantAdmins(site?.tenantId ?? "legacy"),
      rooms.admins(),
    ]).emit("image:reviewed", {
      attachmentId: attachment.id,
      state: attachment.imageReviewState,
    });
  }
}

export async function approveImage(user: SessionUser, id: string) {
  const image = await prisma.attachment.findUnique({
    where: { id },
    select: {
      uploaderId: true,
      siteId: true,
      uploader: true,
      messageId: true,
      mimeType: true,
    },
  });
  if (
    !image ||
    image.uploader !== "VISITOR" ||
    !image.uploaderId ||
    !image.messageId ||
    !image.mimeType.startsWith("image/")
  )
    throw new HttpError(404, "已发送的访客图片不存在");
  if (!canAccessSite(user, image.siteId))
    throw new HttpError(403, "没有该站点的权限");
  const visitorId = image.uploaderId;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${visitorId} FOR UPDATE`;
    const [visitor, current] = await Promise.all([
      tx.visitor.findUnique({
        where: { id: visitorId },
        select: { pendingImageId: true },
      }),
      tx.attachment.findUnique({
        where: { id },
        select: { imageReviewState: true },
      }),
    ]);
    if (!current || !visitor) throw new HttpError(404, "图片不存在");
    if (
      current.imageReviewState === "APPROVED" ||
      current.imageReviewState === "RELEASED"
    )
      return { changed: false, state: current.imageReviewState };
    if (visitor.pendingImageId !== id || current.imageReviewState !== "PENDING")
      throw new HttpError(409, "该图片的待处理状态已变化，请刷新后重试");
    await tx.attachment.update({
      where: { id },
      data: { imageReviewState: "APPROVED" },
    });
    await tx.visitor.update({
      where: { id: visitorId },
      data: { pendingImageId: null },
    });
    return { changed: true, state: "APPROVED" };
  });
  await emitImageGate(visitorId, image.siteId, {
    id,
    imageReviewState: result.state,
  }).catch((error) => console.error("[image-review] Broadcast failed", error));
  return { ...result, attachmentId: id };
}

export async function cancelUnsentImage(visitor: VisitorSession, id: string) {
  const storageKey = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${visitor.visitorId} FOR UPDATE`;
    const image = await tx.attachment.findUnique({
      where: { id },
      select: {
        uploaderId: true,
        uploader: true,
        siteId: true,
        messageId: true,
        storageKey: true,
        mimeType: true,
      },
    });
    if (
      !image ||
      image.uploader !== "VISITOR" ||
      image.uploaderId !== visitor.visitorId ||
      image.siteId !== visitor.siteId ||
      !image.mimeType.startsWith("image/")
    )
      throw new HttpError(404, "图片不存在");
    if (image.messageId)
      throw new HttpError(409, "图片已发送，需等待客服允许，不能取消限制");
    await tx.visitor.updateMany({
      where: { id: visitor.visitorId, pendingImageId: id },
      data: { pendingImageId: null },
    });
    await tx.attachment.delete({ where: { id } });
    return image.storageKey;
  });
  await deleteUpload(storageKey).catch((error) =>
    console.error("[image-review] Cleanup failed", error),
  );
  await emitImageGate(visitor.visitorId, visitor.siteId).catch(console.error);
}
