import { z } from "zod";

export const unansweredRuleSchema = z
  .object({
    enabled: z.boolean(),
    ownerId: z.string().trim().max(128),
    recipientMode: z.enum(["OWNER", "ASSIGNED_OR_OWNER"]),
    delayMinutes: z
      .number()
      .int()
      .min(1, "等待时长至少为 1 分钟")
      .max(10080, "等待时长最多为 7 天"),
    expectedVersion: z.number().int().min(0).max(2147483646),
  })
  .strict()
  .refine((data) => !data.enabled || Boolean(data.ownerId), {
    path: ["ownerId"],
    message: "启用前请选择默认提醒负责人",
  });
export type UnansweredRuleInput = z.infer<typeof unansweredRuleSchema>;
export type UnansweredRuleValue = Omit<
  UnansweredRuleInput,
  "expectedVersion"
> & { version: number };
export type UnansweredRuleDetails = {
  rule: UnansweredRuleValue;
  owners: { id: string; name: string }[];
};

export const unansweredFilterSchema = z
  .object({
    query: z.string().trim().max(120).default(""),
    siteId: z.string().max(128).default(""),
    status: z.enum(["ACTIVE", "RESOLVED", "ALL"]).default("ACTIVE"),
    mine: z.enum(["", "1"]).default(""),
  })
  .strict();
export type UnansweredFilters = z.infer<typeof unansweredFilterSchema>;
export const unansweredResolutions: Record<string, string> = {
  REPLIED: "已回复",
  CLOSED: "会话已结束",
  DISABLED: "规则已关闭",
};

export function unansweredDue(
  waitingSince: Date | null,
  waitingMessageId: string | null,
  rule: { enabled: boolean; enabledAt: Date | null; delayMinutes: number },
  now: Date,
) {
  return Boolean(
    rule.enabled &&
    rule.enabledAt &&
    waitingSince &&
    waitingMessageId &&
    waitingSince >= rule.enabledAt &&
    now.getTime() - waitingSince.getTime() >= rule.delayMinutes * 60000,
  );
}
