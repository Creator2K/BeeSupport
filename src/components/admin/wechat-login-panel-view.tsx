"use client";

import { Loader2, QrCode } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { WechatLoginActions } from "./wechat-login-actions";
import { WechatLoginConfig } from "./wechat-login-config";
import { WechatLoginLogs } from "./wechat-login-logs";
import {
  STATUS_KEY,
  STATUS_TONE,
} from "./wechat-login-types";
import { WechatLoginVisual } from "./wechat-login-visual";
import type { useWechatLogin } from "./use-wechat-login";

export function WechatLoginPanelView({
  controller,
}: {
  controller: ReturnType<typeof useWechatLogin>;
}) {
  const t = useT();
  const {
    state,
    config,
    defaultTo,
    testTo,
    code,
    busy,
    savingTo,
    logsOpen,
    clockReady,
    waiting,
    refresh,
    submitCode,
    startBot,
    restartBot,
    stopBot,
    logoutBot,
    toggleEnabled,
    saveDefaultTo,
    sendTest,
    accountLabel,
    setCode,
    setDefaultTo,
    setLogsOpen,
    setTestTo,
  } = controller;


  return (
    <Card id="wechat-login" className="scroll-mt-20 shadow-none">
      <CardHeader className="items-center gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <QrCode className="size-4" />
          {t("wechat.title")}
        </CardTitle>
        <CardDescription className="text-xs">
          {t("wechat.subtitle")}
        </CardDescription>
        <CardAction>
          <Badge
            className={cn(
              "h-5 shrink-0 px-2 text-[11px]",
              STATUS_TONE[state.status],
            )}
          >
            {t(STATUS_KEY[state.status])}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <WechatLoginVisual state={state} accountLabel={accountLabel} />

          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-muted-foreground text-xs leading-relaxed">
              {state.status === "online"
                ? t("wechat.onlineHint")
                : state.status === "code"
                  ? t("wechat.codeHint")
                  : t("wechat.qrHint")}
            </p>

            {state.status === "code" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("wechat.codeLabel")}</Label>
                <div className="flex max-w-sm gap-1.5">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={t("wechat.codePlaceholder")}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={!code.trim() || busy === "code"}
                    onClick={submitCode}
                  >
                    {busy === "code" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      t("wechat.codeSubmit")
                    )}
                  </Button>
                </div>
              </div>
            ) : null}

            <WechatLoginActions
              state={state}
              busy={busy}
              waiting={waiting}
              onStart={startBot}
              onRestart={restartBot}
              onStop={stopBot}
              onLogout={logoutBot}
              onRefresh={() => void refresh()}
            />

            <WechatLoginConfig
              state={state}
              config={config}
              defaultTo={defaultTo}
              testTo={testTo}
              busy={busy}
              savingTo={savingTo}
              onEnabledChange={(checked) => void toggleEnabled(checked)}
              onDefaultToChange={setDefaultTo}
              onSaveDefaultTo={() => void saveDefaultTo()}
              onTestToChange={setTestTo}
              onSendTest={sendTest}
            />
          </div>
        </div>
        <Separator />

        <WechatLoginLogs
          logs={state.logs}
          open={logsOpen}
          clockReady={clockReady}
          onToggle={() => setLogsOpen((value) => !value)}
        />
      </CardContent>
    </Card>
  );
}
