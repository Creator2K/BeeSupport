import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { deleteUpload, readUploadForm, saveUpload } from "@/lib/storage";
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

/** 访客上传图片 / 文件 */
export async function POST(request: Request): Promise<NextResponse> {
  let storageKey: string | undefined;
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

    const attachment = await prisma.$transaction(
      async (tx) => {
        const gated = file.type.toLowerCase().startsWith("image/")
          ? await assertImageUploadSlot(tx, visitor)
          : false;
        await assertTenantQuota(tx, tenant.id, "storage", file.size);
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
        console.error,
      );

    return NextResponse.json({
      ok: true,
      attachment: serializeAttachment(attachment),
    });
  } catch (error) {
    if (storageKey) await deleteUpload(storageKey).catch(console.error);
    return toErrorResponse(error);
  }
}
