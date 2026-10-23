import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { pickVisitorEnv } from "@/lib/visitor-env";
import { verifyVisitorRequest } from "@/server/services/risk";
import { recordVisitedPage } from "@/server/services/visitors";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const bodySchema = z.object({
  pageUrl: z.string().max(500),
  pageTitle: z.string().max(200).optional(),
  env: z.record(z.string(), scalar).optional(),
  /** 落地页（首次进入的地址），仅在没有记录时写入 */
  landingPage: z.string().max(500).optional(),
});

/**
 * 访客页面轨迹上报：SPA 路由变化或整页刷新时调用。
 * 没有令牌（还没填邮箱）时静默忽略，不做匿名落库。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ip = clientIp(request.headers);
    const limit = await rateLimit(`widget:track:${ip}`, 120, 600);
    if (!limit.ok) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }

    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) return NextResponse.json({ ok: true, skipped: true });

    const input = bodySchema.parse(await readJson(request));

    await recordVisitedPage({
      visitorId: visitor.visitorId,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      env: { ...pickVisitorEnv(input.env), ip },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
