import { LauncherPreview } from "@/components/widget/launcher-preview";
import type {
  EffectiveWidgetSettings,
  WidgetSettings,
} from "@/lib/branding";
import { launcherStyleOptions } from "@/lib/launcher";

import {
  clearBrandingValue,
  setBrandingValue,
} from "./branding-value";

export function BrandingStylePicker({
  value,
  settings,
  onChange,
}: {
  value: WidgetSettings;
  settings: EffectiveWidgetSettings;
  onChange: (settings: WidgetSettings) => void;
}) {
  const overridden = value.launcherStyle !== undefined;

  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border p-4">
      <legend className="px-1 text-sm font-medium">悬浮按钮样式</legend>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={overridden}
          onChange={(e) => {
            if (e.target.checked) {
              onChange(
                setBrandingValue(
                  value,
                  "launcherStyle",
                  settings.launcherStyle,
                ),
              );
            } else {
              onChange(clearBrandingValue(value, "launcherStyle"));
            }
          }}
        />
        覆盖：悬浮按钮样式
      </label>
      <div
        role="group"
        aria-label="悬浮按钮样式选择"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        {launcherStyleOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={!overridden}
            aria-pressed={settings.launcherStyle === option.value}
            aria-label={option.label}
            onClick={() =>
              onChange(
                setBrandingValue(value, "launcherStyle", option.value),
              )
            }
            className="min-w-0 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed aria-pressed:border-foreground aria-pressed:bg-muted/50"
          >
            <span
              aria-hidden="true"
              className="flex h-20 items-center justify-center overflow-hidden"
            >
              <span className="max-w-full origin-center scale-[.8]">
                <LauncherPreview
                  style={option.value}
                  color={settings.primaryColor}
                  label={settings.launcherLabel}
                  logoUrl={settings.logoUrl}
                />
              </span>
            </span>
            <span className="block text-xs font-medium">{option.label}</span>
            <span className="mt-1 hidden text-[11px] leading-4 text-muted-foreground sm:block">
              {option.description}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        文字样式使用下方按钮文案；品牌头像使用 Logo，图片加载失败时显示耳机图标。
      </p>
    </fieldset>
  );
}
