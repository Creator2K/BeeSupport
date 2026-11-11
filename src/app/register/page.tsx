import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ThemeToggle } from "@/components/theme-toggle";

import { RegisterForm } from "./register-form";

export const metadata = { title: "申请商家入驻" };
export default function RegisterPage() {
  return (
    <AuthShell wide actions={<ThemeToggle />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            申请商家入驻
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            提交商家及管理员资料，平台审核开通后，即可接入站点并邀请客服。
          </p>
        </div>
        <RegisterForm />
        <p className="text-muted-foreground text-center text-sm">
          已有账号？
          <Link href="/login" className="ml-1 underline underline-offset-4">
            前往登录
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
