"use client";

import {
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  StopCircle,
} from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { WechatStateView } from "./wechat-login-types";

type WechatLoginActionsProps = {
  state: WechatStateView;
  busy: string | null;
  waiting: boolean;
  onStart: () => void;
  onRestart: () => void;
  onStop: () => void;
  onLogout: () => void;
  onRefresh: () => void;
};

export function WechatLoginActions({
  state,
  busy,
  waiting,
  onStart,
  onRestart,
  onStop,
  onLogout,
  onRefresh,
}: WechatLoginActionsProps) {
  const t = useT();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === "stopped" || state.status === "error" ? (
        <Button size="sm" disabled={busy === "start"} onClick={onStart}>
          {busy === "start" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <QrCode className="size-3.5" />
          )}
          <span className="ml-1.5">{t("wechat.start")}</span>
        </Button>
      ) : null}

      {state.status === "qr" || state.status === "scanned" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy === "restart"}
          onClick={onRestart}
        >
          {busy === "restart" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          <span className="ml-1.5">{t("wechat.restart")}</span>
        </Button>
      ) : null}

      {state.status !== "stopped" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy === "stop"}
          onClick={onStop}
        >
          {busy === "stop" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <StopCircle className="size-3.5" />
          )}
          <span className="ml-1.5">{t("wechat.stop")}</span>
        </Button>
      ) : null}

      {state.hasCredentials || state.status === "online" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy === "logout"}
          onClick={onLogout}
        >
          {busy === "logout" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <LogOut className="size-3.5" />
          )}
          <span className="ml-1.5">{t("wechat.logout")}</span>
        </Button>
      ) : null}

      <Button
        size="sm"
        variant="ghost"
        className="gap-1"
        onClick={onRefresh}
        title={t("common.refresh")}
      >
        <RefreshCw className={cn("size-3.5", waiting && "animate-spin")} />
        {t("common.refresh")}
      </Button>
    </div>
  );
}
