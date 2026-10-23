import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitAgentPresence } from "@/lib/realtime/emit";

const schema = z.object({
  status: z.enum(["ONLINE", "AWAY", "OFFLINE"]),
});

/** 客服手动切换在线状态（在线 / 离开 / 离线） */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { status } = schema.parse(await readJson(request));

    await prisma.user.update({
      where: { id: user.id },
      data: { status, lastSeenAt: new Date() },
    });
    emitAgentPresence(user.id, status);

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
