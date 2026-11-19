"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  EffectiveWidgetSettings,
  WidgetSettings,
} from "@/lib/branding";

import { brandingFields } from "./branding-fields";
import {
  clearBrandingValue,
  setBrandingValue,
} from "./branding-value";

export function BrandingSettingFields({
  value,
  settings,
  canCustomizeFooter,
  onChange,
}: {
  value: WidgetSettings;
  settings: EffectiveWidgetSettings;
  canCustomizeFooter: boolean;
  onChange: (settings: WidgetSettings) => void;
}) {
  const id = useId();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {brandingFields.map(([key, label, type]) => {
        const locked = key === "footerText" && !canCustomizeFooter;
        const overridden = !locked && value[key] !== undefined;
        const inputId = `${id}-${key}`;
        if (key === "launcherDraggable") {
          return (
            <div className="space-y-2 rounded-lg border p-3" key={key}>
              <Label htmlFor={inputId}>{label}</Label>
              <select
                id={inputId}
                value={overridden ? (value[key] ? "on" : "off") : "inherit"}
                onChange={(e) =>
                  onChange(e.target.value === "inherit"
                    ? clearBrandingValue(value, key)
                    : setBrandingValue(value, key, e.target.value === "on"))
                }
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="inherit">
                  {overridden ? "继承默认配置" : `继承默认配置（${settings[key] ? "已开启" : "已关闭"}）`}
                </option>
                <option value="on">开启</option>
                <option value="off">关闭</option>
              </select>
              <p className="text-xs text-muted-foreground">
                访客可用鼠标或手指移动按钮，点击仍可打开聊天。
              </p>
            </div>
          );
        }
        return (
          <div className="space-y-2 rounded-lg border p-3" key={key}>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={overridden}
                disabled={locked}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange(
                      setBrandingValue(value, key, settings[key]),
                    );
                  } else {
                    onChange(clearBrandingValue(value, key));
                  }
                }}
              />
              覆盖：{label}
            </label>
            <Label className="sr-only" htmlFor={inputId}>
              {label}
            </Label>
            {type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  id={inputId}
                  type="checkbox"
                  disabled={!overridden}
                  checked={settings[key] as boolean}
                  onChange={(e) =>
                    onChange(
                      setBrandingValue(value, key, e.target.checked),
                    )
                  }
                />
                {settings[key] ? "已开启" : "已关闭"}
              </label>
            ) : type === "position" ? (
              <select
                id={inputId}
                disabled={!overridden}
                value={String(settings[key])}
                onChange={(e) =>
                  onChange(setBrandingValue(value, key, e.target.value))
                }
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="right">右下角</option>
                <option value="left">左下角</option>
              </select>
            ) : (
              <Input
                id={inputId}
                type={type}
                disabled={!overridden}
                value={String(settings[key])}
                min={type === "number" ? 1 : undefined}
                max={type === "number" ? 20 : undefined}
                maxLength={key === "launcherLabel" ? 20 : undefined}
                onChange={(e) =>
                  onChange(
                    setBrandingValue(
                      value,
                      key,
                      type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                    ),
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
