import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  assertVisitorContentAllowed,
  verifyVisitorRequest,
} from "@/server/services/risk";
import {
  createConversationForVisitor,
  getVisitorConversationState,
} from "@/server/services/conversations";
import { postVisitorMessage } from "@/server/services/messages";

const postSchema = z.object({
  body: z.string().max(5000).default(""),
  conversationId: z.string().optional(),
  clientId: z.string().trim().min(1).max(64).optional(),
  subject: z.string().max(200).optional(),
  attachmentIds: z.array(z.string().min(1)).max(10).optional(),
  source: z.enum(["WIDGET", "OFFLINE_FORM"]).optional(),
});

/** 拉取访客当前会话状态（进行中的会话 + 消息） */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效，请重新填写邮箱");

    const url = new URL(request.url);
    const state = await getVisitorConversationState(
      visitor,
      url.searchParams.get("conversationId") ?? undefined,
      url.searchParams.get("before") ?? undefined,
    );

    return NextResponse.json(state);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** 发起会话或继续发消息 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效，请重新填写邮箱");

    const limit = await rateLimit(
      `widget:message:${visitor.visitorId}`,
      60,
      60,
    );
    if (!limit.ok) {
      return NextResponse.json(
        { error: "发送过于频繁，请稍后再试" },
        { status: 429 },
      );
    }

    const input = postSchema.parse(await readJson(request));
    await assertVisitorContentAllowed({
      ...visitor,
      ip: clientIp(request.headers),
      text: `${input.subject || ""} ${input.body}`,
      context: "message",
    });

    if (!input.body.trim() && (input.attachmentIds?.length ?? 0) === 0) {
      throw new HttpError(400, "消息内容不能为空");
    }

    // 指定了会话：直接续写（已结束的会话会自动重新打开）
    if (input.conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { visitorId: true },
      });
      if (!conversation || conversation.visitorId !== visitor.visitorId) {
        throw new HttpError(404, "会话不存在");
      }

      await postVisitorMessage({
        visitor,
        conversationId: input.conversationId,
        body: input.body,
        attachmentIds: input.attachmentIds ?? [],
        clientId: input.clientId,
      });

      const state = await getVisitorConversationState(
        visitor,
        input.conversationId,
      );
      return NextResponse.json({ created: false, ...state });
    }

    // 没有会话：复用进行中的，否则新建
    const site = await prisma.site.findUnique({
      where: { id: visitor.siteId },
      select: {
        id: true,
        name: true,
        autoAssign: true,
        notifyEmail: true,
        requireEmail: true,
        workHours: true,
      },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    const dbVisitor = await prisma.visitor.findUnique({
      where: { id: visitor.visitorId },
      select: { id: true, email: true, name: true },
    });
    if (!dbVisitor) throw new HttpError(404, "访客不存在");

    const { conversationId, created } = await createConversationForVisitor({
      site: {
        id: site.id,
        name: site.name,
        autoAssign: site.autoAssign,
        notifyEmail: site.notifyEmail,
        workHours: site.workHours,
      },
      visitor: dbVisitor,
      body: input.body,
      subject: input.subject ?? null,
      attachmentIds: input.attachmentIds ?? [],
      source: input.source ?? "WIDGET",
      clientId: input.clientId,
    });

    const state = await getVisitorConversationState(visitor, conversationId);
    return NextResponse.json({ created, ...state });
  } catch (error) {
    return toErrorResponse(error);
  }
}
