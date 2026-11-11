"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AccountAccessFields } from "./account-access-fields";
import type { AccountAccessMode } from "./account-access-types";
import { useAccountAccessForm } from "./use-account-access-form";

export type { AccountAccessMode } from "./account-access-types";

export function AccountAccessForm({ mode }: { mode: AccountAccessMode }) {
  const controller = useAccountAccessForm(mode);
  const { loaded, message, setMessage, requesting } = controller;

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
          className="bg-card rounded-xl border p-4 text-sm leading-6 shadow-xs"
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
  return <AccountAccessFields controller={controller} />;
}
