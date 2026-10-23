import { createHmac } from "node:crypto";

import type { WebhookType } from "@prisma/client";

import { postPublicWebhook } from "./public-webhook";
import { prisma } from "./db";
import { retryNotification } from "../server/retry";

export type WebhookEvent =
  | "conversation.created"
  | "conversation.offline"
  | "conversation.assigned"
  | "conversation.closed"
  | "message.created";

export const WEBHOOK_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: "conversation.created", label: "新会话开始" },
  { value: "conversation.offline", label: "离线留言" },
  { value: "conversation.assigned", label: "会话被接入/转接" },
  { value: "conversation.closed", label: "会话结束" },
  { value: "message.created", label: "有新消息" },
];

export type WebhookPayload = {
  event: WebhookEvent;
  siteId: string;
  siteName: string;
  title: string;
  text: string;
  url?: string;
  data?: Record<string, unknown>;
};

type DeliveryResult = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  skipped?: boolean;
};
class DeliveryError extends Error {
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

/**
 * 把事件推送到所有订阅了它的渠道。
 * 通知失败绝不能影响会话主流程，因此整体吞掉异常。
 */
export async function dispatchWebhooks(payload: WebhookPayload): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        tenant: { sites: { some: { id: payload.siteId } } },
        active: true,
        OR: [{ siteId: null }, { siteId: payload.siteId }],
      },
    });

    const targets = endpoints.filter(
      (endpoint) =>
        endpoint.events.length === 0 || endpoint.events.includes(payload.event),
    );

    let nextTarget = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (nextTarget < targets.length) {
          const endpoint = targets[nextTarget++]!;
          try {
            const result = await retryNotification(
              async () => {
                const result =
                  endpoint.type === "WECHAT_BOT"
                    ? await sendViaInternalBot(endpoint.url, payload)
                    : await sendToEndpoint(
                        endpoint.type,
                        endpoint.url,
                        endpoint.secret,
                        payload,
                        undefined,
                        endpoint.tenantId !== "legacy",
                      );
                if (!result.ok)
                  throw new DeliveryError(
                    result.error ?? "Webhook failed",
                    result.retryable !== false,
                  );
                return result;
              },
              {
                shouldRetry: (error) =>
                  !(error instanceof DeliveryError) || error.retryable,
              },
            );
            await prisma.webhookEndpoint.update({
              where: { id: endpoint.id },
              data: {
                lastStatus: result.ok
                  ? "ok"
                  : `error: ${result.error ?? "未知错误"}`.slice(0, 200),
                lastTriggeredAt: new Date(),
              },
            });
          } catch (error) {
            console.error(`[webhook] ${endpoint.name} 推送失败:`, error);
            await prisma.webhookEndpoint
              .updateMany({
                where: { id: endpoint.id },
                data: {
                  lastTriggeredAt: new Date(),
                  lastStatus:
                    `error: ${error instanceof Error ? error.message : String(error)}`.slice(
                      0,
                      200,
                    ),
                },
              })
              .catch(() => undefined);
          }
        }
      }),
    );
  } catch (error) {
    console.error("[webhook] 分发失败:", error);
  }
}

async function sendToEndpoint(
  type: WebhookType,
  url: string,
  secret: string | null,
  payload: WebhookPayload,
  deliveryId?: string,
  publicOnly = false,
): Promise<DeliveryResult> {
  const { body, headers } = buildRequest(type, url, secret, payload);
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

/** A queue attempt targets one endpoint; successful endpoints are never resent with failed ones. */
export async function sendWebhookDelivery(
  endpointId: string,
  payload: WebhookPayload,
  deliveryId: string,
): Promise<DeliveryResult> {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
  });
  const site = await prisma.site.findUnique({
    where: { id: payload.siteId },
    select: { tenantId: true },
  });
  if (
    !site ||
    endpoint?.tenantId !== site.tenantId ||
    !endpoint ||
    !endpoint.active ||
    (endpoint.siteId && endpoint.siteId !== payload.siteId) ||
    (endpoint.events.length && !endpoint.events.includes(payload.event))
  )
    return { ok: true, skipped: true };
  let result: DeliveryResult;
  try {
    result =
      endpoint.type === "WECHAT_BOT"
        ? await sendViaInternalBot(endpoint.url, payload)
        : await sendToEndpoint(
            endpoint.type,
            endpoint.url,
            endpoint.secret,
            payload,
            deliveryId,
            endpoint.tenantId !== "legacy",
          );
  } catch (error) {
    result = {
      ok: false,
      retryable: true,
      error: error instanceof Error ? error.message : "Delivery failed",
    };
  }
  await prisma.webhookEndpoint.updateMany({
    where: { id: endpoint.id },
    data: {
      lastTriggeredAt: new Date(),
      lastStatus: result.ok
        ? "ok"
        : `error: ${result.error ?? "Delivery failed"}`.slice(0, 200),
    },
  });
  return result;
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
async function sendViaInternalBot(
  target: string,
  payload: WebhookPayload,
): Promise<DeliveryResult> {
  const { sendWechatText } = await import("../server/services/wechatbot");
  return sendWechatText(target, buildPlainText(payload));
}

function buildRequest(
  type: WebhookType,
  url: string,
  secret: string | null,
  payload: WebhookPayload,
): { body: Record<string, unknown>; headers: Record<string, string> } {
  const markdown = [
    `**${payload.title}**`,
    payload.text,
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
        headers["x-beesupport-signature"] = createHmac("sha256", secret)
          .update(raw)
          .digest("hex");
      }
      return { body: payload as unknown as Record<string, unknown>, headers };
    }
  }
}

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
