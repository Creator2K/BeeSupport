"use client";

import { callClientAction } from "@/lib/client-action";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  StopCircle,
} from "lucide-react";
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import { formatClock } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import {
  logoutWechatAction,
  saveWechatConfigAction,
  sendWechatTestAction,
  startWechatAction,
  stopWechatAction,
  submitWechatCodeAction,
} from "@/server/actions/wechat";
import { cn } from "@/lib/utils";

export type WechatStatus =
  "stopped" | "starting" | "qr" | "scanned" | "code" | "online" | "error";

export type WechatLog = {
  at: string;
  level: "info" | "error";
  message: string;
};

export type WechatStateView = {
  status: WechatStatus;
  qrUrl: string | null;
  scanned: boolean;
  account: { userId: string; accountId: string } | null;
  error: string | null;
  hasCredentials: boolean;
  running: boolean;
  storageDir: string;
  logs: WechatLog[];
};

export type WechatConfigView = { enabled: boolean; defaultTo: string };

const STATUS_KEY: Record<WechatStatus, MessageKey> = {
  stopped: "wechat.status.stopped",
  starting: "wechat.status.starting",
  qr: "wechat.status.qr",
  scanned: "wechat.status.scanned",
  code: "wechat.status.code",
  online: "wechat.status.online",
  error: "wechat.status.error",
};

const STATUS_TONE: Record<WechatStatus, string> = {
  stopped: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  starting: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  qr: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  scanned: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  code: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  online: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
};

/**
 * 微信个人号扫码登录面板。
 * 内嵌在「通知渠道」页里：微信渠道用的就是这里登录的机器人。
 */
export function WechatLoginPanel({
  initialState,
  initialConfig,
}: {
  initialState: WechatStateView;
  initialConfig: WechatConfigView;
}) {
  const t = useT();
  const [state, setState] = useState(initialState);
  const [config, setConfig] = useState(initialConfig);
  const [defaultTo, setDefaultTo] = useState(initialConfig.defaultTo);
  const [testTo, setTestTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [savingTo, setSavingTo] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [clockReady, setClockReady] = useState(false);

  useEffect(() => setClockReady(true), []);

  const waiting =
    state.status === "starting" ||
    state.status === "qr" ||
    state.status === "scanned" ||
    state.status === "code";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/wechat", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        state: WechatStateView;
        config: WechatConfigView;
      };
      setState(data.state);
      setConfig(data.config);
    } catch {
      // 轮询失败下一轮继续
    }
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  function applyResult(result: {
    ok: boolean;
    message?: string;
    error?: string;
    state?: WechatStateView;
  }) {
    if (result.state) setState(result.state);
    if (result.ok) toast.success(result.message ?? t("common.saved"));
    else toast.error(result.error ?? t("common.operationFailed"));
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const accountLabel =
    state.account?.userId ||
    state.account?.accountId ||
    t("wechat.unknownAccount");

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
          <div className="bg-muted/40 flex size-[184px] shrink-0 items-center justify-center self-start rounded-lg border">
            {state.qrUrl &&
            (state.status === "qr" || state.status === "scanned") ? (
              <div className="rounded-md bg-white p-2">
                <QRCodeSVG value={state.qrUrl} size={156} level="M" />
              </div>
            ) : state.status === "starting" ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            ) : state.status === "online" ? (
              <div className="px-4 text-center">
                <CheckCircle2 className="mx-auto size-7 text-emerald-500" />
                <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                  {t("wechat.loggedInAs", { name: accountLabel })}
                </p>
              </div>
            ) : state.status === "code" ? (
              <div className="px-4 text-center">
                <Smartphone className="text-muted-foreground mx-auto size-7" />
                <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                  {t("wechat.codeHint")}
                </p>
              </div>
            ) : state.status === "error" ? (
              <div className="px-4 text-center">
                <AlertTriangle className="mx-auto size-7 text-red-500" />
                <p className="text-muted-foreground mt-2 text-[11px] break-all">
                  {state.error ?? t("wechat.status.error")}
                </p>
              </div>
            ) : (
              <div className="px-4 text-center">
                <QrCode className="text-muted-foreground mx-auto size-7" />
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {t("wechat.noQr")}
                </p>
              </div>
            )}
          </div>

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
                    onClick={() =>
                      void run("code", async () => {
                        const result = await callClientAction(
                          () => submitWechatCodeAction(code),
                          t("common.operationFailed"),
                        );
                        setCode("");
                        applyResult(result);
                        void refresh();
                      })
                    }
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

            <div className="flex flex-wrap items-center gap-2">
              {state.status === "stopped" || state.status === "error" ? (
                <Button
                  size="sm"
                  disabled={busy === "start"}
                  onClick={() =>
                    void run("start", async () => {
                      applyResult(
                        await callClientAction(
                          () => startWechatAction(),
                          t("common.operationFailed"),
                        ),
                      );
                    })
                  }
                >
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
                  onClick={() =>
                    void run("restart", async () => {
                      await callClientAction(
                        () => stopWechatAction(),
                        t("common.operationFailed"),
                      );
                      applyResult(
                        await callClientAction(
                          () => startWechatAction(),
                          t("common.operationFailed"),
                        ),
                      );
                    })
                  }
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
                  onClick={() =>
                    void run("stop", async () => {
                      applyResult(
                        await callClientAction(
                          () => stopWechatAction(),
                          t("common.operationFailed"),
                        ),
                      );
                    })
                  }
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
                  onClick={() =>
                    void run("logout", async () => {
                      applyResult(
                        await callClientAction(
                          () => logoutWechatAction(),
                          t("common.operationFailed"),
                        ),
                      );
                    })
                  }
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
                onClick={() => void refresh()}
                title={t("common.refresh")}
              >
                <RefreshCw
                  className={cn("size-3.5", waiting && "animate-spin")}
                />
                {t("common.refresh")}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="space-y-0.5">
                <Label className="text-xs">{t("wechat.enabled")}</Label>
                <p className="text-muted-foreground text-[11px]">
                  {t("wechat.enabledHint")}
                </p>
              </div>
              <Switch
                aria-label={t("wechat.enabled")}
                checked={config.enabled}
                onCheckedChange={async (checked) => {
                  setConfig((prev) => ({ ...prev, enabled: checked }));
                  const result = await callClientAction(
                    () => saveWechatConfigAction({ enabled: checked }),
                    t("common.operationFailed"),
                  );
                  if (!result.ok) {
                    toast.error(result.error);
                    setConfig((prev) => ({ ...prev, enabled: !checked }));
                    return;
                  }
                  if (checked && state.status !== "online") {
                    applyResult(
                      await callClientAction(
                        () => startWechatAction({ enabled: true }),
                        t("common.operationFailed"),
                      ),
                    );
                  } else if (!checked && state.status !== "stopped") {
                    applyResult(
                      await callClientAction(
                        () => stopWechatAction(),
                        t("common.operationFailed"),
                      ),
                    );
                  }
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("wechat.defaultTo")}</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={defaultTo}
                    onChange={(event) => setDefaultTo(event.target.value)}
                    placeholder={t("wechat.defaultToPlaceholder")}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savingTo}
                    onClick={async () => {
                      setSavingTo(true);
                      try {
                        const result = await callClientAction(
                          () => saveWechatConfigAction({ defaultTo }),
                          t("common.operationFailed"),
                        );
                        if (result.ok) {
                          setConfig(result.config);
                          setDefaultTo(result.config.defaultTo);
                          toast.success(t("common.saved"));
                        } else {
                          toast.error(result.error);
                        }
                      } finally {
                        setSavingTo(false);
                      }
                    }}
                  >
                    {savingTo ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      t("common.save")
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t("wechat.sendTest")}</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={testTo}
                    onChange={(event) => setTestTo(event.target.value)}
                    placeholder={t("wechat.toPlaceholder")}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "test" || state.status !== "online"}
                    onClick={() =>
                      void run("test", async () => {
                        const result = await callClientAction(
                          () => sendWechatTestAction({ to: testTo }),
                          t("common.operationFailed"),
                        );
                        if (result.ok) {
                          toast.success(result.message ?? t("wechat.testSent"));
                        } else {
                          toast.error(result.error);
                        }
                      })
                    }
                  >
                    {busy === "test" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    <span className="ml-1.5">{t("wechat.test")}</span>
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-muted-foreground text-[11px]">
              {t("wechat.storageHint", { dir: state.storageDir })}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <button
            type="button"
            className="text-muted-foreground inline-flex items-center gap-1 text-xs"
            onClick={() => setLogsOpen((value) => !value)}
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                logsOpen && "rotate-180",
              )}
            />
            {t("wechat.logs")}
          </button>

          {logsOpen ? (
            state.logs.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-xs">
                {t("wechat.noLogs")}
              </p>
            ) : (
              <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-[11px]">
                {state.logs.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {clockReady
                        ? formatClock(item.at)
                        : item.at.slice(11, 19)}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words",
                        item.level === "error" &&
                          "text-red-600 dark:text-red-400",
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
      </CardContent>
    </Card>
  );
}
