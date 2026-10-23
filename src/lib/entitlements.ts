import { z } from "zod";
export const FEATURE_LABELS = {
  removeBranding: "自定义底部品牌",
  ai: "AI 自动回复与客服草稿",
  advancedAnalytics: "整体访客画像统计",
};
export const LEGACY_FEATURES = {
  removeBranding: true,
  ai: true,
  advancedAnalytics: true,
};
export const BASIC_FEATURES = {
  removeBranding: false,
  ai: false,
  advancedAnalytics: false,
};
export const featuresSchema = z
  .object({
    removeBranding: z.boolean(),
    ai: z.boolean(),
    advancedAnalytics: z.boolean(),
  })
  .strict();
export type TenantFeatures = z.infer<typeof featuresSchema>;
/** Missing legacy documents preserve existing access. Malformed explicit documents fail closed. */
export function readFeatures(value: unknown): TenantFeatures {
  if (
    value == null ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  )
    return { ...LEGACY_FEATURES };
  const parsed = featuresSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...BASIC_FEATURES };
}
