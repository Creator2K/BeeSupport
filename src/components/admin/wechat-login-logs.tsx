"use client";

import { ChevronDown } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { WechatLog } from "./wechat-login-types";

type WechatLoginLogsProps = {
  logs: WechatLog[];
  open: boolean;
  clockReady: boolean;
  onToggle: () => void;
};

export function WechatLoginLogs({
  logs,
  open,
  clockReady,
  onToggle,
}: WechatLoginLogsProps) {
  const t = useT();

  return (
    <div>
      <button
        type="button"
        className="text-muted-foreground inline-flex items-center gap-1 text-xs"
        onClick={onToggle}
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
        {t("wechat.logs")}
      </button>

      {open ? (
        logs.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("wechat.noLogs")}
          </p>
        ) : (
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-[11px]">
            {logs.map((item, index) => (
              <li key={`${item.at}-${index}`} className="flex gap-2">
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {clockReady ? formatClock(item.at) : item.at.slice(11, 19)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 break-words",
                    item.level === "error" && "text-red-600 dark:text-red-400",
                  )}
                >
                  {item.message}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
