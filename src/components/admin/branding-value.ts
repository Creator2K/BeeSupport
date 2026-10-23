import type { WidgetSettings } from "@/lib/branding";

export type BrandingValue = NonNullable<WidgetSettings[keyof WidgetSettings]>;

export function setBrandingValue(
  value: WidgetSettings,
  key: keyof WidgetSettings,
  next: BrandingValue,
): WidgetSettings {
  return { ...value, [key]: next };
}

export function clearBrandingValue(
  value: WidgetSettings,
  key: keyof WidgetSettings,
): WidgetSettings {
  const next = { ...value };
  delete next[key];
  return next;
}
