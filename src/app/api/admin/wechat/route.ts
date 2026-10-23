import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/auth";
import { getWechatConfig, getWechatState } from "@/server/services/wechatbot";

/** 微信机器人状态轮询：二维码、扫码进度、日志 */
export async function GET(): Promise<NextResponse> {
  try {
    await requirePlatformAdmin();
    const [state, config] = await Promise.all([
      Promise.resolve(getWechatState()),
      getWechatConfig(),
    ]);
    return NextResponse.json(
      { state, config },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
