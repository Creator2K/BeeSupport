"use client";

import { callClientAction } from "@/lib/client-action";

import { useCallback, useEffect, useState } from "react";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { WechatLoginActions } from "./wechat-login-actions";
import { WechatLoginConfig } from "./wechat-login-config";
import { WechatLoginLogs } from "./wechat-login-logs";
import {
  STATUS_KEY,
  STATUS_TONE,
  type WechatConfigView,
  type WechatStateView,
} from "./wechat-login-types";
import { WechatLoginVisual } from "./wechat-login-visual";
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
import {
  logoutWechatAction,
  saveWechatConfigAction,
  sendWechatTestAction,
  startWechatAction,
  stopWechatAction,
  submitWechatCodeAction,
} from "@/server/actions/wechat";
import { cn } from "@/lib/utils";

export type { WechatConfigView, WechatLog, WechatStateView, WechatStatus } from "./wechat-login-types";

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

  function submitCode() {
    void run("code", async () => {
      const result = await callClientAction(
        () => submitWechatCodeAction(code),
        t("common.operationFailed"),
      );
      setCode("");
      applyResult(result);
      void refresh();
    });
  }

  function startBot() {
    void run("start", async () => {
      applyResult(
        await callClientAction(
          () => startWechatAction(),
          t("common.operationFailed"),
        ),
      );
    });
  }

  function restartBot() {
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
    });
  }

  function stopBot() {
    void run("stop", async () => {
      applyResult(
        await callClientAction(
          () => stopWechatAction(),
          t("common.operationFailed"),
        ),
      );
    });
  }

  function logoutBot() {
    void run("logout", async () => {
      applyResult(
        await callClientAction(
          () => logoutWechatAction(),
          t("common.operationFailed"),
        ),
      );
    });
  }

  async function toggleEnabled(checked: boolean) {
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
  }

  async function saveDefaultTo() {
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
  }

  function sendTest() {
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
    });
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
