import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { HttpError } from "../../lib/auth";
import { getSmtpConfig } from "../../lib/mail";
import { emailSchema } from "../../lib/validation";
import { deliveryKinds } from "../../lib/deliveries";
import { prepareAccountMail } from "./account-mail";
import { prepareExpiryMail } from "./subscription-reminders";

export async function assertRetryable(
  row: { id: string; kind: string; payload: Prisma.JsonValue },
  tx: Prisma.TransactionClient,
) {
  if (!Object.hasOwn(deliveryKinds, row.kind))
    throw new HttpError(400, "不支持此任务类型，请检查后台服务版本");
  if (row.kind !== "WEBHOOK" && !(await getSmtpConfig()))
    throw new HttpError(400, "请先在系统设置配置 SMTP 邮件服务");
  if (row.kind === "ACCOUNT_MAIL") {
    const prepared = await prepareAccountMail(row.payload, row.id);
    if (!prepared.ok)
      throw new HttpError(
        400,
        "账号链接已失效或发送条件已变更，请重新申请邮件或邀请",
      );
  } else if (row.kind === "SUBSCRIPTION_MAIL") {
    if (!(await prepareExpiryMail(row.payload)).ok)
      throw new HttpError(400, "到期提醒已失效或邮件提醒未启用，不可重试");
  } else if (row.kind === "MAIL") {
    if (
      !z
        .object({
          to: z.union([emailSchema, z.array(emailSchema).min(1)]),
          subject: z.string(),
          text: z.string(),
        })
        .safeParse(row.payload).success
    )
      throw new HttpError(400, "邮件任务数据已失效");
  } else {
    const parsed = z
      .object({
        endpointId: z.string(),
        webhook: z.object({ siteId: z.string(), event: z.string() }),
      })
      .safeParse(row.payload);
    if (!parsed.success) throw new HttpError(400, "通知任务数据已失效");
    const [endpoint, site] = await Promise.all([
      tx.webhookEndpoint.findUnique({ where: { id: parsed.data.endpointId } }),
      tx.site.findUnique({
        where: { id: parsed.data.webhook.siteId },
        select: { tenantId: true },
      }),
    ]);
    if (
      !endpoint?.active ||
      !site ||
      endpoint.tenantId !== site.tenantId ||
      (endpoint.siteId && endpoint.siteId !== parsed.data.webhook.siteId) ||
      (endpoint.events.length &&
        !endpoint.events.includes(parsed.data.webhook.event))
    )
      throw new HttpError(400, "通知渠道已停用、删除或不再订阅此事件");
  }
}
