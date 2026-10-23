"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccountAccessMode = "forgot" | "reset" | "verify" | "invite";
type Details = { email: string; team: string; role: string };

async function callAccount(body: Record<string, unknown>) {
  const response = await fetch("/api/auth/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败，请稍后重试");
  return result;
}

export function AccountAccessForm({ mode }: { mode: AccountAccessMode }) {
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
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

  if (!loaded)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        正在检查链接…
      </p>
    );
  if (message)
    return (
      <div className="space-y-5">
        <p
          role="status"
          className="rounded-lg border bg-muted p-4 text-sm leading-6"
        >
          {message}
        </p>
        <Link className="block text-center text-sm underline" href="/login">
          前往登录
        </Link>
        {requesting && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setMessage("")}
          >
            返回重新填写邮箱
          </Button>
        )}
      </div>
    );
  return (
    <form className="space-y-4" onSubmit={submit}>
      {details && (
        <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-6">
          <p className="break-all">{details.email}</p>
          {mode === "invite" && (
            <p>
              加入「{details.team}」 · {details.role}
            </p>
          )}
        </div>
      )}
      {requesting && (
        <div className="space-y-2">
          <Label htmlFor="account-email">账号邮箱</Label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            maxLength={200}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      )}
      {!invalid && mode === "invite" && (
        <div className="space-y-2">
          <Label htmlFor="account-name">姓名</Label>
          <Input
            id="account-name"
            autoComplete="name"
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
      {!invalid && needsPassword && (
        <>
          <div className="space-y-2">
            <Label htmlFor="account-password">新密码（8–72 位）</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-confirmation">再次输入新密码</Label>
            <Input
              id="account-confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
        </>
      )}
      {(error || invalid) && (
        <p role="alert" className="text-sm text-destructive">
          {error || "缺少有效链接，请使用邮件中的完整链接。"}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending || invalid}>
        {pending ? "提交中…" : submitLabel}
      </Button>
      {mode === "reset" && (
        <Link
          href="/forgot-password"
          className="block text-center text-sm underline"
        >
          重新申请重置链接
        </Link>
      )}
      {mode === "verify" && token && (
        <Link
          href="/verify-email"
          onClick={() => window.location.assign("/verify-email")}
          className="block text-center text-sm underline"
        >
          重新发送验证邮件
        </Link>
      )}
      {mode === "invite" && (
        <p className="text-xs leading-5 text-muted-foreground">
          邀请有效期 72 小时。链接失效或团队额度不足时，请联系邀请你的管理员。
        </p>
      )}
    </form>
  );
}
