import { prisma } from "../../lib/db";
import { logger } from "../../lib/logger";
import type { WechatBotConfig } from "./wechatbot-runtime";

export const WECHATBOT_SETTING_KEY = "wechatbot";

export function defaultWechatConfig(): WechatBotConfig {
  return {
    enabled: process.env.WECHATBOT_ENABLED === "true",
    defaultTo: process.env.WECHATBOT_DEFAULT_TO?.trim() ?? "",
  };
}

export async function getWechatConfig(): Promise<WechatBotConfig> {
  const defaults = defaultWechatConfig();
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: WECHATBOT_SETTING_KEY },
    });
    if (!setting?.value) return defaults;
    const stored = setting.value as Partial<WechatBotConfig>;
    return {
      enabled:
        typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
      defaultTo:
        typeof stored.defaultTo === "string" ? stored.defaultTo : defaults.defaultTo,
    };
  } catch (error) {
    logger.error("wechat.config_load_failed", {}, error);
    return defaults;
  }
}

export async function saveWechatConfig(
  patch: Partial<WechatBotConfig>,
): Promise<WechatBotConfig> {
  const current = await getWechatConfig();
  const next: WechatBotConfig = {
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    defaultTo:
      patch.defaultTo === undefined ? current.defaultTo : patch.defaultTo.trim().slice(0, 120),
  };

  await prisma.setting.upsert({
    where: { key: WECHATBOT_SETTING_KEY },
    create: { key: WECHATBOT_SETTING_KEY, value: next },
    update: { value: next },
  });

  return next;
}

/* ---------------- 状态 ---------------- */
