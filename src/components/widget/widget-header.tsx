/* eslint-disable @next/next/no-img-element -- Tenant logos are external URLs rendered directly, without a server image proxy. */
"use client";

import { X } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { accentGradient } from "@/lib/color";
import { launcherForeground } from "@/lib/launcher";
import { cn } from "@/lib/utils";

import type { SiteConfig } from "./widget-types";

type WidgetHeaderProps = {
  config: SiteConfig | null;
  online: boolean;
  onClose: () => void;
};

export function WidgetHeader({ config, online, onClose }: WidgetHeaderProps) {
  const t = useT();
  const accentColor = config?.primaryColor ?? "#18181b";

  return (
    <header
      className="pattern-hex flex shrink-0 items-center gap-3 px-4 py-3.5 text-white"
      style={
        {
          backgroundColor: accentColor,
          backgroundImage: accentGradient(accentColor),
          color: launcherForeground(accentColor),
          "--pattern-origin": "100% 0%",
          "--pattern-opacity": 0.1,
        } as React.CSSProperties
      }
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-current/15 text-sm font-semibold ring-1 ring-current/25">
        {config?.logoUrl ? (
          <img
            src={config.logoUrl}
            alt=""
            className="size-9 rounded-full object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          (config?.name ?? "B").slice(0, 1)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-5 font-semibold">
          {config?.title || config?.name || t("widget.greetingTitle")}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] opacity-85">
          <span
            className={cn(
              "size-1.5 rounded-full ring-2 ring-current/20",
              online ? "bg-emerald-400" : "bg-zinc-300",
            )}
          />
          {online ? t("widget.siteOnline") : t("widget.siteOffline")}
        </div>
      </div>
      <button
        type="button"
        aria-label={t("widget.close")}
        className="rounded-full p-1.5 transition-colors hover:bg-current/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </header>
  );
}
