/* eslint-disable @next/next/no-img-element -- Tenant logos are external URLs rendered directly, without a server image proxy. */
"use client";

import { X } from "lucide-react";

import { useT } from "@/components/locale-provider";
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
      className="flex shrink-0 items-center gap-2.5 px-3.5 py-3 text-white"
      style={{
        backgroundColor: accentColor,
        color: launcherForeground(accentColor),
      }}
    >
      <div className="flex size-8 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
        {config?.logoUrl ? (
          <img
            src={config.logoUrl}
            alt=""
            className="size-8 rounded-full object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          (config?.name ?? "B").slice(0, 1)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {config?.title || config?.name || t("widget.greetingTitle")}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] opacity-85">
          <span
            className={cn(
              "size-1.5 rounded-full",
              online ? "bg-emerald-400" : "bg-zinc-300",
            )}
          />
          {online ? t("widget.siteOnline") : t("widget.siteOffline")}
        </div>
      </div>
      <button
        type="button"
        aria-label={t("widget.close")}
        className="rounded-md p-1.5 transition-colors hover:bg-white/15"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </header>
  );
}
