import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata = { title: "申请商家入驻" };
export default function RegisterPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <Link href="/" className="text-sm font-medium">
            BeeSupport
          </Link>
          <h1 className="mt-6 text-2xl font-semibold">申请商家入驻</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            提交商家及管理员资料，平台审核开通后，即可接入站点并邀请客服。
          </p>
        </div>
        <RegisterForm />
        <p className="text-center text-sm text-muted-foreground">
          已有账号？
          <Link href="/login" className="ml-1 underline">
            前往登录
          </Link>
        </p>
      </div>
    </main>
  );
}
