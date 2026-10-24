"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { callClientAction } from "@/lib/client-action";
import {
  logoutWechatAction,
  saveWechatConfigAction,
  sendWechatTestAction,
  startWechatAction,
  stopWechatAction,
  submitWechatCodeAction,
} from "@/server/actions/wechat";
import type {
  WechatConfigView,
  WechatStateView,
} from "./wechat-login-types";

export function useWechatLogin({
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

  return {
    state,
    setState,
    config,
    setConfig,
    defaultTo,
    setDefaultTo,
    testTo,
    setTestTo,
    code,
    setCode,
    busy,
    savingTo,
    logsOpen,
    setLogsOpen,
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
  };
}
