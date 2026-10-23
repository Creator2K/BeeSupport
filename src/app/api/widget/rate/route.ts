import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import {
  assertVisitorContentAllowed,
  verifyVisitorRequest,
} from "@/server/services/risk";
import { clientIp } from "@/lib/rate-limit";
import { getWidgetSettings } from "@/server/services/tenants";
import { rateConversation } from "@/server/services/conversations";

const schema = z.object({
  conversationId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

/** 访客对本次服务评分（满意度过统计用） */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效");

    if (!(await getWidgetSettings(visitor.siteId)).ratingEnabled)
      throw new HttpError(403, "此站点已关闭服务评价");
    const input = schema.parse(await readJson(request));
    await assertVisitorContentAllowed({
      ...visitor,
      ip: clientIp(request.headers),
      text: input.comment || "",
      context: "rating",
    });
    await rateConversation(
      visitor,
      input.conversationId,
      input.rating,
      input.comment,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
