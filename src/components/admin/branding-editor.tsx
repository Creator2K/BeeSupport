/* eslint-disable @next/next/no-img-element -- Tenant logos are external URLs rendered directly, without a server image proxy. */
"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LauncherPreview } from "@/components/widget/launcher-preview";
import {
  mergeWidgetSettings,
  type WidgetSettings,
  type EffectiveWidgetSettings,
} from "@/lib/branding";

import { launcherStyleOptions, launcherForeground } from "@/lib/launcher";

const fields = [
  ["title", "聊天窗口标题", "text"],
  ["logoUrl", "Logo 图片地址", "url"],
  ["footerText", "底部品牌文字（可留空）", "text"],
  ["primaryColor", "主题色", "color"],
  ["position", "悬浮按钮位置", "position"],
  ["launcherLabel", "悬浮按钮文案（最多 20 字）", "text"],
  ["maxUploadMB", "单个附件大小上限 MB", "number"],
  ["imagesEnabled", "允许访客发送图片", "boolean"],
  ["filesEnabled", "允许访客发送文件", "boolean"],
  ["emojiEnabled", "显示表情选择器", "boolean"],
  ["ratingEnabled", "允许服务评价", "boolean"],
] as const;

export function BrandingEditor({
  value,
  inherited,
  onChange,
  canCustomizeFooter = true,
}: {
  value: WidgetSettings;
  inherited: EffectiveWidgetSettings;
  onChange: (settings: WidgetSettings) => void;
  canCustomizeFooter?: boolean;
}) {
  const id = useId();
  const [mobile, setMobile] = useState(false);
  const settings = mergeWidgetSettings(inherited, value);
  if (!canCustomizeFooter) settings.footerText = inherited.footerText;
  const set = (key: keyof WidgetSettings, next: string | boolean | number) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-muted-foreground">
        勾选后覆盖上一级配置；取消勾选后随上一级更新。配置按平台、商家、站点依次生效。保存后，新打开的聊天窗口使用最新配置。
      </p>
      <fieldset className="min-w-0 space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">悬浮按钮样式</legend>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={value.launcherStyle !== undefined}
            onChange={(e) => {
              if (e.target.checked)
                set("launcherStyle", settings.launcherStyle);
              else {
                const next = { ...value };
                delete next.launcherStyle;
                onChange(next);
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
              disabled={value.launcherStyle === undefined}
              aria-pressed={settings.launcherStyle === option.value}
              aria-label={option.label}
              onClick={() => set("launcherStyle", option.value)}
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
          文字样式使用下方按钮文案；品牌头像使用
          Logo，图片加载失败时显示耳机图标。
        </p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([key, label, type]) => {
          const locked = key === "footerText" && !canCustomizeFooter;
          const overridden = !locked && value[key] !== undefined;
          const inputId = `${id}-${key}`;
          return (
            <div className="space-y-2 rounded-lg border p-3" key={key}>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={overridden}
                  disabled={locked}
                  onChange={(e) => {
                    if (e.target.checked) set(key, settings[key]);
                    else {
                      const next = { ...value };
                      delete next[key];
                      onChange(next);
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
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  {settings[key] ? "已开启" : "已关闭"}
                </label>
              ) : type === "position" ? (
                <select
                  id={inputId}
                  disabled={!overridden}
                  value={String(settings[key])}
                  onChange={(e) => set(key, e.target.value)}
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
                    set(
                      key,
                      type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({})}
        >
          全部恢复继承
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mobile ? "outline" : "secondary"}
            onClick={() => setMobile(false)}
          >
            电脑预览
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mobile ? "secondary" : "outline"}
            onClick={() => setMobile(true)}
          >
            手机预览
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-muted/30 p-3">
        <p className="mb-3 text-xs text-muted-foreground">
          聊天窗口与悬浮按钮预览
        </p>
        <div
          className={`mx-auto overflow-hidden rounded-xl border bg-background shadow-sm ${mobile ? "max-w-[280px]" : "max-w-sm"}`}
        >
          <div
            className="flex items-center gap-3 p-4 text-white"
            style={{
              backgroundColor: settings.primaryColor,
              color: launcherForeground(settings.primaryColor),
            }}
          >
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt="品牌 Logo"
                className="size-9 rounded-full bg-white object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-white/20">
                聊
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {settings.title || "在线客服"}
              </p>
              <p className="text-xs opacity-80">在线 · 为你提供帮助</p>
            </div>
          </div>
          <div className="space-y-4 p-4 text-sm">
            <div className="mr-5 rounded-lg bg-muted p-3">
              你好，请问有什么可以帮到你？
            </div>
            <div
              className="ml-8 rounded-lg p-3 text-white"
              style={{
                backgroundColor: settings.primaryColor,
                color: launcherForeground(settings.primaryColor),
              }}
            >
              我想了解产品详情
            </div>
            <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
              输入消息… {settings.emojiEnabled ? "☺" : ""}{" "}
              {settings.imagesEnabled || settings.filesEnabled ? "＋" : ""}
            </div>
            <p className="text-center text-[10px] text-muted-foreground">
              {settings.footerText}
            </p>
          </div>
        </div>
        <div
          className={`mx-auto mt-4 flex ${mobile ? "max-w-[280px]" : "max-w-sm"} ${settings.position === "left" ? "justify-start" : "justify-end"}`}
          aria-label="悬浮按钮预览"
          role="img"
        >
          <LauncherPreview
            style={settings.launcherStyle}
            color={settings.primaryColor}
            label={settings.launcherLabel}
            logoUrl={settings.logoUrl}
          />
        </div>
      </div>
    </div>
  );
}
