import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { canAccessSite, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { streamUpload } from "@/lib/storage";
import { verifyVisitorRequest } from "@/server/services/risk";

/**
 * 附件下载 / 内联展示。
 * 权限：客服要有该站点权限；访客要是该会话的访客本人。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        message: {
          select: { type: true, conversation: { select: { visitorId: true } } },
        },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const user = await getCurrentUser();
    const agentAllowed = Boolean(
      user && canAccessSite(user, attachment.siteId),
    );
    const visitor = agentAllowed
      ? null
      : await verifyVisitorRequest(request.headers);
    const visitorAllowed = Boolean(
      visitor &&
      visitor.siteId === attachment.siteId &&
      attachment.message?.type !== "NOTE" &&
      ((attachment.uploader === "VISITOR" &&
        visitor.visitorId === attachment.uploaderId) ||
        visitor.visitorId === attachment.message?.conversation.visitorId),
    );

    if (!agentAllowed && !visitorAllowed) {
      return NextResponse.json({ error: "无权访问该文件" }, { status: 403 });
    }

    const file = await streamUpload(attachment.storageKey);
    const isInline = attachment.mimeType.startsWith("image/");

    return new NextResponse(file.body, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(file.size),
        "content-disposition": `${isInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
