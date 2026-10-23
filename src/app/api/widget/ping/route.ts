import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyVisitorRequest } from "@/server/services/risk";
import { getSiteAvailability } from "@/lib/widget";

/**
 * 访客心跳：续期在线状态（Redis 里 90 秒 TTL），
 * 顺便返回最新可用性，前端据此在「在线/离线」之间切换提示。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效");

    const site = await prisma.site.findUnique({
      where: { id: visitor.siteId },
      select: { id: true, workHours: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    const { markVisitorOnline } = await import("@/server/presence");
    await markVisitorOnline(visitor.visitorId);
    await prisma.visitor.update({
      where: { id: visitor.visitorId },
      data: { lastSeenAt: new Date() },
    });

    const availability = await getSiteAvailability(site);
    return NextResponse.json({ ok: true, availability });
  } catch (error) {
    return toErrorResponse(error);
  }
}
