import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { HttpError, canAccessSite, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  assertTenantQuota,
  assertSiteServing,
} from "@/server/services/tenants";
import { deleteUpload, readUploadForm, saveUpload } from "@/lib/storage";

/**
 * 客服上传附件：先把文件落盘并把 Attachment 记成「未绑定消息」，
 * 发送消息时带上 attachmentIds 完成绑定。
 */
export async function POST(request: Request): Promise<NextResponse> {
  let storageKey: string | undefined;
  try {
    const user = await requireUser();
    const formData = await readUploadForm(request);
    const file = formData.get("file");
    const siteId = String(formData.get("siteId") ?? "");
    const conversationId = String(formData.get("conversationId") ?? "");

    if (!(file instanceof File)) throw new HttpError(400, "缺少文件");
    if (!siteId) throw new HttpError(400, "缺少站点参数");
    if (!canAccessSite(user, siteId))
      throw new HttpError(403, "无权访问该站点");

    if (conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { siteId: true },
      });
      if (!conversation || conversation.siteId !== siteId) {
        throw new HttpError(400, "会话与站点不匹配");
      }
    }

    const tenant = await assertSiteServing(siteId);
    const attachment = await prisma.$transaction(
      async (tx) => {
        await assertTenantQuota(tx, tenant.id, "storage", file.size);
        const saved = await saveUpload(file, {
          siteId,
          uploader: "AGENT",
          uploaderId: user.id,
        });
        storageKey = saved.storageKey;
        return tx.attachment.create({
          data: {
            siteId,
            uploader: "AGENT",
            uploaderId: user.id,
            filename: saved.filename,
            mimeType: saved.mimeType,
            size: saved.size,
            storageKey: saved.storageKey,
          },
        });
      },
      { timeout: 15000 },
    );
    storageKey = undefined;

    return NextResponse.json({
      ok: true,
      attachment: {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: `/api/files/${attachment.id}`,
        isImage: attachment.mimeType.startsWith("image/"),
      },
    });
  } catch (error) {
    if (storageKey) await deleteUpload(storageKey).catch(console.error);
    return toErrorResponse(error);
  }
}
