import { prisma } from "./db";
import { logger } from "./logger";
import { retryNotification } from "../server/retry";
import type { WebhookPayload, DeliveryResult } from "./webhook-types";
import {
  DeliveryError,
  sendToEndpoint,
  sendViaInternalBot,
} from "./webhook-request";

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
            logger.error(
              "webhook.delivery_failed",
              { endpointId: endpoint.id, endpointName: endpoint.name },
              error,
            );
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
    logger.error("webhook.dispatch_failed", {}, error);
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
