"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { callAccount } from "./account-access-api";
import type {
  AccountAccessDetails,
  AccountAccessMode,
} from "./account-access-types";

export function useAccountAccessForm(mode: AccountAccessMode) {
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<AccountAccessDetails | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    let mounted = true;
    const advanceGeneration = () => ++generation.current;
    const load = () => {
      const current = advanceGeneration();
      const raw =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      setLoaded(false);
      setToken(raw);
      setDetails(null);
      setMessage("");
      setError("");
      setPassword("");
      setConfirmation("");
      setPending(false);
      if (mode === "forgot" || !raw) {
        setLoaded(true);
        return;
      }
      callAccount({
        operation: "inspect",
        token: raw,
        purpose:
          mode === "reset" ? "RESET" : mode === "verify" ? "VERIFY" : "INVITE",
      })
        .then((result) => {
          if (mounted && current === generation.current)
            setDetails(result.details);
        })
        .catch((reason) => {
          if (mounted && current === generation.current)
            setError(
              reason instanceof Error ? reason.message : "无法读取链接，请重试",
            );
        })
        .finally(() => {
          if (mounted && current === generation.current) setLoaded(true);
        });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => {
      mounted = false;
      advanceGeneration();
      window.removeEventListener("hashchange", load);
    };
  }, [mode]);

  const requesting = mode === "forgot" || (mode === "verify" && !token);
  const needsPassword = mode === "reset" || mode === "invite";
  const invalid = !requesting && !details;
  const submitLabel = requesting
    ? "发送邮件"
    : mode === "reset"
      ? "重置密码"
      : mode === "verify"
        ? "确认验证邮箱"
        : "接受邀请并创建账号";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (needsPassword && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    const current = generation.current;
    try {
      const result = await callAccount(
        requesting
          ? {
              operation:
                mode === "forgot" ? "request-reset" : "request-verification",
              email,
            }
          : {
              operation:
                mode === "reset"
                  ? "reset"
                  : mode === "verify"
                    ? "verify"
                    : "accept",
              token,
              ...(needsPassword ? { password } : {}),
              ...(mode === "invite" ? { name } : {}),
            },
      );
      if (current !== generation.current) return;
      setMessage(result.message);
      setPassword("");
      setConfirmation("");
      if (!requesting)
        window.history.replaceState(null, "", window.location.pathname);
    } catch (reason) {
      if (current !== generation.current) return;
      setError(
        reason instanceof Error ? reason.message : "请求失败，请稍后重试",
      );
    } finally {
      if (current === generation.current) setPending(false);
    }
  }

  return {
    mode,
    token,
    loaded,
    details,
    email,
    setEmail,
    name,
    setName,
    password,
    setPassword,
    confirmation,
    setConfirmation,
    pending,
    error,
    message,
    setMessage,
    requesting,
    needsPassword,
    invalid,
    submitLabel,
    submit,
  };
}

export type AccountAccessController = ReturnType<
  typeof useAccountAccessForm
>;
