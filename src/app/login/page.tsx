import Link from "next/link";
import { redirect } from "next/navigation";

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
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
        >
          BeeSupport
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 space-y-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {t("auth.title")}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("auth.subtitle")}
            </p>
          </div>

          <LoginForm />
          <p className="mt-4 text-center text-sm">
            <Link
              href="/register"
              className="text-muted-foreground underline hover:text-foreground"
            >
              申请商家入驻
            </Link>
          </p>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              {t("auth.backHome")}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
