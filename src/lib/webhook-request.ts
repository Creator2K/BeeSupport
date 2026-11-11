import { createHmac } from "node:crypto";

import type { WebhookType } from "@prisma/client";

import { postPublicWebhook } from "./public-webhook";
import type { WebhookPayload, DeliveryResult } from "./webhook-types";

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Bound response consumption as well as request time, including chunked responses. */
async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) {
        void reader.cancel().catch(() => undefined);
        throw new DeliveryError("通知服务响应超过 16 KiB", false);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    reader.releaseLock();
  }
}

export async function sendToEndpoint(
  type: WebhookType,
  url: string,
  secret: string | null,
  payload: WebhookPayload,
  deliveryId?: string,
  publicOnly = false,
): Promise<DeliveryResult> {
  const { body, headers } = buildRequest(
    type,
    url,
    secret,
    payload,
    deliveryId,
  );
  if (deliveryId) headers["x-beesupport-delivery-id"] = deliveryId;

  const response = publicOnly
    ? await postPublicWebhook(url, JSON.stringify(body), headers)
    : await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

  if (!response.ok) {
    const text = await readResponseText(response).catch((error: unknown) =>
      error instanceof Error ? error.message : "",
    );
    return {
      ok: false,
      error: `${response.status} ${text.slice(0, 160)}`,
      retryable:
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    };
  }

  if (type === "GENERIC") {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true };
  }
  try {
    const result = JSON.parse(await readResponseText(response)) as Record<
      string,
      unknown
    > | null;
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new DeliveryError("通知服务返回了无效的响应", false);
    if (type === "DINGTALK" || type === "WECHAT_WORK") {
      if (result.errcode === 0) return { ok: true };
      return {
        ok: false,
        error: `渠道拒绝 (${String(result.errcode ?? "unknown")}): ${String(result.errmsg ?? "未知错误").slice(0, 160)}`,
        retryable: false,
      };
    }
    // Telegram and the local WeChat bridge use an explicit boolean acknowledgement.
    if (result.ok === true) return { ok: true };
    const code = Number(result.error_code);
    return {
      ok: false,
      error: String(
        result.description ?? result.error ?? "通知服务未确认发送成功",
      ).slice(0, 200),
      retryable: code === 408 || code === 429 || code >= 500,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "通知服务返回了无效的响应",
      retryable:
        error instanceof DeliveryError
          ? error.retryable
          : !(error instanceof SyntaxError),
    };
  }
}

/** 把事件正文拼成纯文本（微信里不用 Markdown） */
export function buildPlainText(payload: WebhookPayload): string {
  return [
    payload.title,
    "",
    payload.text,
    payload.url ? `\n${payload.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 内置微信机器人（后台扫码登录的那个）直接发消息 */
export async function sendViaInternalBot(
  target: string,
  payload: WebhookPayload,
): Promise<DeliveryResult> {
  const { sendWechatText } = await import("../server/services/wechatbot");
  return sendWechatText(target, buildPlainText(payload));
}

const FULL_WIDTH: Record<string, string> = {
  "[": "［",
  "]": "］",
  "<": "＜",
  ">": "＞",
};

/**
 * 钉钉和企业微信的 Markdown 没有转义写法，访客写的内容原样拼进去会被当成语法：
 * 伪装成「打开会话」的链接、自动加载的外链图片、@ 群成员、带颜色的标签、大号标题。
 * 这里把方括号、尖括号和行首的 # 换成全角，读起来一样，但不再被解析。
 * 加粗、斜体、行内代码只影响那段文字自己的样式，不处理：下划线常见于邮箱，星号常见于正常文字。
 */
function markdownText(value: string): string {
  return value
    .replace(/[[\]<>]/g, (character) => FULL_WIDTH[character]!)
    .replace(/^([^\S\r\n]*)#/gm, "$1＃");
}

function buildRequest(
  type: WebhookType,
  url: string,
  secret: string | null,
  payload: WebhookPayload,
  deliveryId?: string,
): { body: Record<string, unknown>; headers: Record<string, string> } {
  const markdown = [
    `**${markdownText(payload.title)}**`,
    markdownText(payload.text),
    payload.url ? `[打开会话](${payload.url})` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const plainText = buildPlainText(payload);

  switch (type) {
    case "TELEGRAM":
      // url 建议填 https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
      return {
        body: {
          text: `${payload.title}\n\n${payload.text}${payload.url ? `\n${payload.url}` : ""}`,
          disable_web_page_preview: true,
        },
        headers: { "content-type": "application/json" },
      };
    case "DINGTALK":
      return {
        body: {
          msgtype: "markdown",
          markdown: { title: payload.title, text: markdown },
        },
        headers: { "content-type": "application/json" },
      };
    case "WECHAT_WORK":
      return {
        body: { msgtype: "markdown", markdown: { content: markdown } },
        headers: { "content-type": "application/json" },
      };
    case "WECHAT": {
      // 交给 wechatbot 桥接服务（scripts/wechatbot-bridge.mjs）：
      // 地址形如 http://127.0.0.1:8787/send?to=<wxid 或备注名>
      let to = "";
      try {
        to = new URL(url).searchParams.get("to") ?? "";
      } catch {
        to = "";
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (secret) headers.authorization = `Bearer ${secret}`;
      return { body: { to, text: plainText }, headers };
    }
    default: {
      const raw = JSON.stringify(payload);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-beesupport-event": payload.event,
      };
      if (secret) {
        // 旧签名只覆盖请求体，截获的请求可以原样重放；已接入的接收方按它校验，所以保留
        headers["x-beesupport-signature"] = createHmac("sha256", secret)
          .update(raw)
          .digest("hex");
        // 新签名把发送时刻和投递编号一起签进去：接收方拒绝过期的时间戳、按投递编号去重，就能挡住重放。
        // 后台「测试推送」没有投递编号，那一段按空字符串算
        const timestamp = String(Math.floor(Date.now() / 1000));
        headers["x-beesupport-timestamp"] = timestamp;
        headers["x-beesupport-signature-v2"] = createHmac("sha256", secret)
          .update(`${timestamp}.${deliveryId ?? ""}.${raw}`)
          .digest("hex");
      }
      return { body: payload as unknown as Record<string, unknown>, headers };
    }
  }
}
