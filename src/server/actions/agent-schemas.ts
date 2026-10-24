import { z } from "zod";

import { emailSchema, passwordSchema } from "@/lib/validation";

export const createSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(40),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(["ADMIN", "AGENT"]).default("AGENT"),
  siteIds: z.array(z.string()).max(200).default([]),
  active: z.boolean().default(true),
});

export const updateSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(40),
  role: z.enum(["ADMIN", "AGENT"]),
  siteIds: z.array(z.string()).max(200).default([]),
  active: z.boolean(),
});

export type CreateAgentInput = z.input<typeof createSchema>;
export type UpdateAgentInput = z.input<typeof updateSchema>;
