"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as {
        error?: string;
        redirectTo?: string;
        user?: { name: string };
      };

      if (!response.ok) {
        setError(data.error ?? t("auth.failed"));
        return;
      }

      toast.success(`${t("common.login")} · ${data.user?.name ?? ""}`);
      router.replace(data.redirectTo ?? "/agent");
      router.refresh();
    } catch {
      setError(t("common.operationFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="sr-only">
        <CardTitle>{t("auth.title")}</CardTitle>
        <CardDescription>{t("auth.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.passwordLabel")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("auth.submitting")}
              </>
            ) : (
              t("auth.submit")
            )}
          </Button>
          <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
            <Link href="/forgot-password" className="underline">
              忘记密码
            </Link>
            <Link href="/verify-email" className="underline">
              重新发送验证邮件
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
