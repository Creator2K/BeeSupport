import { z } from "zod";

export const deliveryKinds = {
  MAIL: "会话邮件",
  ACCOUNT_MAIL: "账号邮件",
  SUBSCRIPTION_MAIL: "到期提醒邮件",
  WEBHOOK: "Webhook 通知",
} as const;
export const deliveryStates = {
  PENDING: "等待发送",
  PROCESSING: "发送中",
  FAILED: "失败",
  SUCCESS: "已投递",
  SKIPPED: "已跳过",
  LEGACY: "历史已处理",
} as const;
export type DeliveryState = keyof typeof deliveryStates;
export function deliveryState(job: {
  status: string;
  outcome: string | null;
}): DeliveryState | "UNKNOWN" {
  if (job.status === "DELIVERED")
    return job.outcome === "SUCCESS"
      ? "SUCCESS"
      : job.outcome === "SKIPPED"
        ? "SKIPPED"
        : "LEGACY";
  return job.status === "PENDING" ||
    job.status === "PROCESSING" ||
    job.status === "FAILED"
    ? job.status
    : "UNKNOWN";
}

/** Return a bounded category, never raw SMTP responses, URLs, payloads or credentials. */
export function deliveryDiagnostic(error: string | null, state: string) {
  if (state === "SKIPPED") return "发送条件已变更或渠道未启用，未实际投递";
  if (state === "LEGACY") return "旧记录未区分实际投递与条件跳过";
  if (!error)
    return state === "FAILED" ? "发送未完成，请检查渠道配置后重试" : "";
  if (/lease/i.test(error)) return "处理超时，请检查后台服务运行状态";
  if (/invalid.*payload|unknown.*kind|decrypt|credential/i.test(error))
    return "任务数据失效，账号邮件请重新申请链接";
  if (/EAUTH|authentication|535|认证/i.test(error))
    return "邮件账号认证失败，请检查 SMTP 配置";
  if (/timeout|timed.out|ETIMEDOUT|超时/i.test(error)) return "连接或响应超时";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed/i.test(error))
    return "无法连接通知渠道，请检查地址与服务状态";
  if (/private|blocked|unsafe|not allowed|安全|内网/i.test(error))
    return "通知目标未通过安全检查";
  if (/SMTP|邮件/i.test(error)) return "邮件服务不可用，请检查 SMTP 配置";
  return "投递失败，请检查渠道配置与服务状态";
}

export const retryDeliverySchema = z
  .object({
    id: z.string().min(1).max(100),
    updatedAt: z.iso.datetime(),
    manualRetries: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type RetryDeliveryInput = z.input<typeof retryDeliverySchema>;
