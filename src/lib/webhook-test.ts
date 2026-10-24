import type { WebhookType } from "@prisma/client";

import type { WebhookPayload } from "./webhook-types";
import {
  sendToEndpoint,
  sendViaInternalBot,
} from "./webhook-request";

/** 后台「测试推送」用 */
export async function testWebhook(
  type: WebhookType,
  url: string,
  secret: string | null,
  siteId: string,
  siteName: string,
  publicOnly = false,
): Promise<{ ok: boolean; error?: string }> {
  const payload: WebhookPayload = {
    event: "conversation.created",
    siteId,
    siteName,
    title: "BeeSupport 测试通知",
    text: `这是一条测试消息，来自站点「${siteName}」。收到即代表渠道配置成功。`,
    url: undefined,
  };

  if (type === "WECHAT_BOT") return sendViaInternalBot(url, payload);
  return sendToEndpoint(type, url, secret, payload, undefined, publicOnly);
}
