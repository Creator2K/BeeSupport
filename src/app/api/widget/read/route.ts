import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyVisitorRequest } from "@/server/services/risk";
import { markConversationRead } from "@/server/services/messages";

const schema = z.object({ conversationId: z.string().min(1) });

/** 访客已读回执 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效");

    const { conversationId } = schema.parse(await readJson(request));

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { visitorId: true },
    });
    if (!conversation || conversation.visitorId !== visitor.visitorId) {
      throw new HttpError(404, "会话不存在");
    }

    await markConversationRead({ conversationId, by: "VISITOR", visitor });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
