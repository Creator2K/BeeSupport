import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AccountAccessForm,
  type AccountAccessMode,
} from "./account-access-form";
import { getSmtpConfig } from "@/lib/mail";

const copy = {
  forgot: ["忘记密码", "填写账号邮箱，收到邮件后设置新密码。"],
  reset: ["设置新密码", "重置成功后，原有登录会话会失效。"],
  verify: [
    "验证邮箱",
    "通过邮件链接确认邮箱；没有收到邮件时，可在此重新申请。",
  ],
  invite: ["接受团队邀请", "确认团队信息并设置自己的登录密码。"],
};

export async function AccountAccessPage({ mode }: { mode: AccountAccessMode }) {
  const smtpReady = Boolean(await getSmtpConfig());
  return (
    <AuthShell actions={<ThemeToggle />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            {copy[mode][0]}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {copy[mode][1]}
          </p>
        </div>
        {!smtpReady && (mode === "forgot" || mode === "verify") && (
          <p className="bg-card text-muted-foreground rounded-xl border p-3.5 text-sm leading-6">
            平台尚未配置邮件服务。请联系管理员使用后台重置密码入口；已有邮件链接仍可提交。
          </p>
        )}
        <AccountAccessForm mode={mode} />
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/login" className="underline underline-offset-4">
            返回登录
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
