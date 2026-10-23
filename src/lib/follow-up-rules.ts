import { z } from "zod";

export const followUpRuleSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    enabled: z.boolean(),
    ownerId: z.string().trim().max(128),
    delayMinutes: z
      .number()
      .int()
      .min(1, "处理时限至少为 1 分钟")
      .max(10080, "处理时限最多为 7 天"),
  })
  .strict()
  .refine((value) => !value.enabled || Boolean(value.ownerId), {
    message: "启用自动跟进前请选择负责人",
    path: ["ownerId"],
  });

export type FollowUpRuleInput = z.infer<typeof followUpRuleSchema>;
export type FollowUpRuleDetails = {
  site: { id: string; name: string; active: boolean };
  rule: {
    enabled: boolean;
    ownerId: string;
    delayMinutes: number;
    version: number;
  };
  owners: { id: string; name: string }[];
  ownerAvailable: boolean;
};
