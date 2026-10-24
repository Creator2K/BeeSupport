import { getWechatConfig } from "./wechatbot-config";
import { log, runtime } from "./wechatbot-runtime";

export async function sendWechatText(
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const state = runtime();
  const config = await getWechatConfig();
  const target = (to || config.defaultTo || "").trim();

  if (!target) return { ok: false, error: "未填写微信接收人" };
  if (!state.bot) return { ok: false, error: "微信机器人未启动，请先在后台扫码登录" };
  if (state.status !== "online") {
    return { ok: false, error: "微信未登录（需要扫码）" };
  }

  try {
    await state.bot.send(target, { text });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `发送给 ${target} 失败：${message}`);
    return { ok: false, error: message.slice(0, 200) };
  }
}

/** 配置里开了 enabled 就自动启动（服务启动时调用一次） */
