import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { loginDestination } from "@/server/services/onboarding";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";

import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(await loginDestination(user));
  }

  const { t } = await getServerT();

  return (
    <AuthShell
      actions={
        <>
          <LanguageSwitcher />
          <ThemeToggle />
        </>
      }
    >
      <div className="mb-7 space-y-2">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">
          {t("auth.title")}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("auth.subtitle")}
        </p>
      </div>

      <LoginForm />
      <p className="mt-5 text-center text-sm">
        <Link
          href="/register"
          className="text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          申请商家入驻
        </Link>
      </p>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        <Link href="/" className="hover:text-foreground">
          {t("auth.backHome")}
        </Link>
      </p>
    </AuthShell>
  );
}
