"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountAccessController } from "./use-account-access-form";

export function AccountAccessFields({
  controller,
}: {
  controller: AccountAccessController;
}) {
  const {
    mode,
    token,
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
    requesting,
    needsPassword,
    invalid,
    submitLabel,
    submit,
  } = controller;

  return (
    <form className="space-y-4" onSubmit={submit}>
      {details && (
        <div className="bg-card rounded-xl border p-4 text-sm leading-6">
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
