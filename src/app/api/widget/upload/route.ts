import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  acquireUploadSlot,
  deleteUpload,
  readUploadForm,
  saveUpload,
} from "@/lib/storage";
import {
  assertVisitorContentAllowed,
  verifyVisitorRequest,
} from "@/server/services/risk";
import {
  assertImageUploadSlot,
  emitImageGate,
} from "@/server/services/image-review";
import {
  assertTenantQuota,
  assertSiteServing,
  assertVisitorUploadAllowed,
} from "@/server/services/tenants";
import { serializeAttachment } from "@/server/serialize";

// The widget sends each upload right away, so unsent files only pile up when
// sends fail or the upload endpoint is called directly.
const MAX_UNSENT_ATTACHMENTS = 10;

/** 访客上传图片 / 文件 */
export async function POST(request: Request): Promise<NextResponse> {
  let storageKey: string | undefined;
  let releaseSlot: (() => void) | undefined;
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效，请刷新页面");

    const ipLimit = await rateLimit(
      `widget:upload-ip:${clientIp(request.headers)}`,
      60,
      300,
    );
    if (!ipLimit.ok)
      throw new HttpError(429, "当前网络上传过于频繁，请稍后再试");

    const limit = await rateLimit(
      `widget:upload:${visitor.visitorId}`,
      20,
      300,
    );
    if (!limit.ok) {
      return NextResponse.json(
        { error: "上传过于频繁，请稍后再试" },
        { status: 429 },
      );
    }

    releaseSlot = await acquireUploadSlot(
      `visitor-ip:${clientIp(request.headers)}`,
    );
    const formData = await readUploadForm(request);
    const file = formData.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "缺少文件");
    await assertVisitorUploadAllowed(visitor.siteId, file);
    const tenant = await assertSiteServing(visitor.siteId);
    await assertVisitorContentAllowed({
      ...visitor,
      ip: clientIp(request.headers),
      text: file.name,
      context: "filename",
    });

    // Counting requests alone lets one address fill a tenant's storage with
    // maximum-size files, so each address also gets a size budget.
    const megabytes = Math.max(1, Math.ceil(file.size / 1_048_576));
    const ip = clientIp(request.headers);
    const budgets = await Promise.all([
      rateLimit(`widget:upload-mb:${ip}`, 200, 3600, megabytes),
      rateLimit(`widget:upload-mb-day:${ip}`, 500, 86400, megabytes),
    ]);
    if (budgets.some((budget) => !budget.ok))
      throw new HttpError(429, "当前网络上传的文件总量过大，请稍后再试");

    const attachment = await prisma.$transaction(
      async (tx) => {
        const gated = file.type.toLowerCase().startsWith("image/")
          ? await assertImageUploadSlot(tx, visitor)
          : false;
        await assertTenantQuota(tx, tenant.id, "storage", file.size);
        // The tenant lock taken above serialises this count with concurrent uploads.
        const unsent = await tx.attachment.count({
          where: {
            siteId: visitor.siteId,
            uploader: "VISITOR",
            uploaderId: visitor.visitorId,
            messageId: null,
          },
        });
        if (unsent >= MAX_UNSENT_ATTACHMENTS)
          throw new HttpError(429, "未发送的附件过多，请稍后再试");
        const saved = await saveUpload(file, {
          siteId: visitor.siteId,
          uploader: "VISITOR",
          uploaderId: visitor.visitorId,
        });
        storageKey = saved.storageKey;
        const attachment = await tx.attachment.create({
          data: {
            siteId: visitor.siteId,
            uploader: "VISITOR",
            uploaderId: visitor.visitorId,
            filename: saved.filename,
            mimeType: saved.mimeType,
            size: saved.size,
            storageKey: saved.storageKey,
            imageReviewState: gated ? "PENDING" : "NONE",
          },
        });
        if (gated)
          await tx.visitor.update({
            where: { id: visitor.visitorId },
            data: { pendingImageId: attachment.id },
          });
        return attachment;
      },
      { timeout: 15000 },
    );
    storageKey = undefined;
    if (attachment.imageReviewState === "PENDING")
      await emitImageGate(visitor.visitorId, visitor.siteId).catch(
        (error: unknown) =>
          logger.error(
            "image_review.broadcast_failed",
            { attachmentId: attachment.id },
            error,
          ),
      );

    return NextResponse.json({
      ok: true,
      attachment: serializeAttachment(attachment),
    });
  } catch (error) {
    if (storageKey)
      await deleteUpload(storageKey).catch((cleanupError: unknown) =>
        logger.error("uploads.cleanup_failed", { storageKey }, cleanupError),
      );
    return toErrorResponse(error);
  } finally {
    releaseSlot?.();
  }
}
