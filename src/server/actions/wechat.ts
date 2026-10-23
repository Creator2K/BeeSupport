"use server";

import { z } from "zod";

import { HttpError, requirePlatformAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  getWechatConfig,
  getWechatState,
  logoutWechatBot,
  saveWechatConfig,
  sendWechatText,
  startWechatBot,
  stopWechatBot,
  submitWechatCode,
  type WechatBotConfig,
  type WechatBotState,
} from "@/server/services/wechatbot";
import { toActionResult, type ActionResult } from "./result";

type WechatActionResult =
  | { ok: true; message?: string; state: WechatBotState }
  | { ok: false; error: string; state: WechatBotState };

function failure(error: unknown): WechatActionResult {
  const result: ActionResult = toActionResult(error);
  return {
    ok: false,
    error: result.ok ? "操作失败" : result.error,
    state: getWechatState(),
  };
}

/** 开始扫码登录（同时把 enabled 打开，重启后自动恢复） */
export async function startWechatAction(input?: {
  enabled?: boolean;
}): Promise<WechatActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await saveWechatConfig({ enabled: input?.enabled ?? true });
    const state = await startWechatBot();

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "wechat.start",
      targetType: "Setting",
      targetId: "wechatbot",
    });

    return { ok: true, message: "正在获取二维码", state };
  } catch (error) {
    return failure(error);
  }
}

export async function stopWechatAction(): Promise<WechatActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await saveWechatConfig({ enabled: false });
    const state = stopWechatBot();

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "wechat.stop",
      targetType: "Setting",
      targetId: "wechatbot",
    });

    return { ok: true, message: "已停止", state };
  } catch (error) {
    return failure(error);
  }
}

export async function logoutWechatAction(): Promise<WechatActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const state = await logoutWechatBot();

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "wechat.logout",
      targetType: "Setting",
      targetId: "wechatbot",
    });

    return { ok: true, message: "已退出登录", state };
  } catch (error) {
    return failure(error);
  }
}

export async function submitWechatCodeAction(
  code: string,
): Promise<WechatActionResult> {
  try {
    await requirePlatformAdmin();
    const value = z.string().trim().min(1, "请输入配对码").max(20).parse(code);
    const accepted = submitWechatCode(value);
    if (!accepted) {
      return {
        ok: false,
        error: "当前没有等待中的配对码请求",
        state: getWechatState(),
      };
    }
    return { ok: true, message: "已提交配对码", state: getWechatState() };
  } catch (error) {
    return failure(error);
  }
}

export async function saveWechatConfigAction(input: {
  enabled?: boolean;
  defaultTo?: string;
}): Promise<
  { ok: true; config: WechatBotConfig } | { ok: false; error: string }
> {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = z
      .object({
        enabled: z.boolean().optional(),
        defaultTo: z.string().trim().max(120).optional(),
      })
      .parse(input);

    const config = await saveWechatConfig(parsed);

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "wechat.config.update",
      targetType: "Setting",
      targetId: "wechatbot",
      meta: { enabled: config.enabled },
    });

    return { ok: true, config };
  } catch (error) {
    const result = toActionResult(error);
    return { ok: false, error: result.ok ? "保存失败" : result.error };
  }
}

/** 测试发送：没填接收人就用配置里的默认接收人 */
export async function sendWechatTestAction(input: {
  to?: string;
  text?: string;
}): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const parsed = z
      .object({
        to: z.string().trim().max(120).optional(),
        text: z.string().trim().max(1000).optional(),
      })
      .parse(input);

    if (!parsed.to) {
      const config = await getWechatConfig();
      if (!config.defaultTo) throw new HttpError(400, "请先填写默认接收人");
    }

    const result = await sendWechatText(
      parsed.to ?? "",
      parsed.text || "BeeSupport 测试消息：收到即代表微信通知可用。",
    );

    return result.ok
      ? { ok: true, message: "测试消息已发送" }
      : { ok: false, error: result.error ?? "发送失败" };
  } catch (error) {
    return toActionResult(error);
  }
}
