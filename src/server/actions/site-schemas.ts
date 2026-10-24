import { randomBytes } from "node:crypto";

import { z } from "zod";

import { widgetSettingsSchema } from "@/lib/branding";
import { siteSlugSchema } from "@/lib/validation";

const originSchema = z.string().trim().max(200);

const workHoursSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return !/^[+-]/.test(value);
        } catch {
          return false;
        }
      }, "工作时间时区无效")
      .optional(),
    days: z
      .record(
        z.string().regex(/^[0-6]$/),
        z
          .array(
            z
              .tuple([
                z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              ])
              .refine(
                ([start, end]) => start !== end,
                "开始和结束时间不能相同",
              ),
          )
          .max(12),
      )
      .optional(),
  })
  .nullable()
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "通知邮箱格式不正确",
  );

export const siteInputSchema = z.object({
  widgetSettings: widgetSettingsSchema.optional(),
  name: z.string().trim().min(1, "请填写站点名称").max(60),
  slug: siteSlugSchema,
  description: z.string().trim().max(200).optional().nullable(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "主题色格式应为 #RRGGBB")
    .default("#18181b"),
  position: z.enum(["right", "left"]).default("right"),
  welcomeMessage: z.string().trim().min(1).max(500),
  offlineMessage: z.string().trim().min(1).max(500),
  requireEmail: z.boolean().default(true),
  autoAssign: z.boolean().default(true),
  imageReviewEnabled: z.boolean().optional(),
  notifyEmail: optionalEmail,
  allowedOrigins: z.array(originSchema).max(50).default([]),
  workHours: workHoursSchema,
  active: z.boolean().default(true),
});

export type SiteInput = z.input<typeof siteInputSchema>;

export function generatePublicKey(): string {
  return `bs_${randomBytes(16).toString("hex")}`;
}
