/* eslint-disable @next/next/no-img-element -- Tenant logos are external URLs rendered directly, without a server image proxy. */
import { LauncherPreview } from "@/components/widget/launcher-preview";
import type { EffectiveWidgetSettings } from "@/lib/branding";
import { launcherForeground } from "@/lib/launcher";

export function BrandingPreview({
  settings,
  mobile,
}: {
  settings: EffectiveWidgetSettings;
  mobile: boolean;
}) {
  return (
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
  );
}
