import { z } from "zod";
export const REMINDER_SETTING_KEY = "subscriptions.reminders";
export const DEFAULT_REMINDERS = {
  enabled: true,
  mailEnabled: false,
  leadDays: 7,
};
export const reminderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    mailEnabled: z.boolean(),
    leadDays: z
      .number()
      .int()
      .refine((value) => [7, 14, 30].includes(value), "请选择 7、14 或 30 天"),
  })
  .strict();
export function readReminderSettings(value: unknown) {
  const parsed = z
    .object({ revision: z.string(), settings: reminderSettingsSchema })
    .safeParse(value);
  return parsed.success
    ? parsed.data
    : { revision: "initial", settings: DEFAULT_REMINDERS };
}
export function reminderPhase(
  expiresAt: Date | null,
  now: Date,
  leadDays: number,
): number | null {
  if (!expiresAt) return null;
  const remaining = (expiresAt.getTime() - now.getTime()) / 86400000;
  if (remaining <= 0) return remaining >= -7 ? 0 : null;
  return (
    [1, 3, 7, 14, 30].find((days) => days <= leadDays && remaining <= days) ??
    null
  );
}
export function reminderText(
  tenant: { name: string; planName: string; expiresAt: Date },
  phase: number,
) {
  const date = tenant.expiresAt.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
  return {
    title:
      phase === 0 ? "服务已到期，请及时续费" : `服务将在 ${phase} 天内到期`,
    body: `${tenant.name} 的「${tenant.planName}」有效期至 ${date}（北京时间）。${phase === 0 ? "访客接待已暂停，历史记录保留。" : "为保持访客接待连续，请提前安排续费。"}请进入「套餐与续费」提交订单，由平台核对收款并开通。`,
  };
}
