import { z } from "zod";
import { LAUNCHER_STYLES, type LauncherStyle } from "./launcher";

const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Logo 请使用 http 或 https 图片地址");

/** Sparse overrides preserve inheritance, including explicit false and empty text. */
export const widgetSettingsSchema = z
  .object({
    title: z.string().trim().max(60).optional(),
    logoUrl: imageUrl.optional(),
    footerText: z.string().trim().max(100).optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "请选择六位十六进制颜色")
      .optional(),
    position: z.enum(["left", "right"]).optional(),
    launcherStyle: z.enum(LAUNCHER_STYLES).optional(),
    launcherLabel: z.string().trim().max(20).optional(),
    launcherDraggable: z.boolean().optional(),
    imagesEnabled: z.boolean().optional(),
    filesEnabled: z.boolean().optional(),
    emojiEnabled: z.boolean().optional(),
    ratingEnabled: z.boolean().optional(),
    maxUploadMB: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export const defaultWidgetSettings = {
  title: "在线客服",
  logoUrl: "",
  footerText: "Powered by BeeSupport",
  primaryColor: "#18181b",
  position: "right" as "left" | "right",
  launcherStyle: "bubble" as LauncherStyle,
  launcherLabel: "在线客服",
  launcherDraggable: false,
  imagesEnabled: true,
  filesEnabled: true,
  emojiEnabled: true,
  ratingEnabled: true,
  maxUploadMB: 10,
};
export type EffectiveWidgetSettings = typeof defaultWidgetSettings;
export function parseWidgetSettings(value: unknown): WidgetSettings {
  const parsed = widgetSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
export function mergeWidgetSettings(
  ...layers: unknown[]
): EffectiveWidgetSettings {
  return Object.assign(
    {},
    defaultWidgetSettings,
    ...layers.map(parseWidgetSettings),
  );
}
