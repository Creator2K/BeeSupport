import { z } from "zod";

import { AI_AUTO_REPLY_VALUES, AI_OVER_LIMIT_ACTIONS } from "@/lib/ai-policy";

const optionalLimit = z.union([
  z.null(),
  z.coerce.number().int().min(0).max(100_000_000),
]);

export const aiPolicySaveSchema = z.object({
  scope: z.enum(["tenant", "site"]),
  siteId: z.string().trim().max(100).optional().nullable(),
  version: z.coerce.number().int().min(0).max(1_000_000),
  enabledMode: z.enum(["inherit", "on", "off"]),
  autoReply: z.enum(AI_AUTO_REPLY_VALUES),
  assistantName: z.string().max(40),
  systemPrompt: z.string().max(4000),
  toolsMode: z.enum(["inherit", "on", "off"]),
  mutationsMode: z.enum(["inherit", "on", "off"]),
  monthlyRequestLimit: optionalLimit,
  monthlyTokenLimit: optionalLimit,
  concurrencyLimit: z.union([
    z.null(),
    z.coerce.number().int().min(1).max(8),
  ]),
  overLimitAction: z.union([z.enum(AI_OVER_LIMIT_ACTIONS), z.literal("inherit")]),
});

export type AiPolicySavePayload = z.input<typeof aiPolicySaveSchema>;
