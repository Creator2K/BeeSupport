"use client";

import { callClientAction } from "@/lib/client-action";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changePasswordAction,
  updateProfileAction,
} from "@/server/actions/auth";

export function AccountSettings({
  user,
}: {
  user: { name: string; email: string; locale: string };
}) {
  const { t, setLocale: setInterfaceLocale } = useLocale();
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [locale, setLocale] = useState<"zh-CN" | "en">(
    user.locale === "en" ? "en" : "zh-CN",
  );
  const [profilePending, setProfilePending] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);

  async function handleProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfilePending(true);
    const result = await callClientAction(
      () => updateProfileAction({ name, locale }),
      t("common.operationFailed"),
    );
    setProfilePending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("common.saved"));
    setInterfaceLocale(locale);
    router.refresh();
  }

  async function handlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordMismatch"));
      return;
    }

    setPasswordPending(true);
    const result = await callClientAction(
      () => changePasswordAction({ currentPassword, newPassword }),
      t("common.operationFailed"),
    );
    setPasswordPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(t("settings.passwordChanged"));
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("settings.profile")}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleProfile}>
            <div className="space-y-2">
              <Label htmlFor="profile-name">{t("settings.displayName")}</Label>
              <Input
                id="profile-name"
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.interfaceLanguage")}</Label>
              <Select
                value={locale}
                onValueChange={(value) =>
                  setLocale(value === "en" ? "en" : "zh-CN")
                }
              >
                <SelectTrigger aria-label={t("settings.interfaceLanguage")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">简体中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {t("settings.savedHint")}
              </p>
            </div>
            <Button type="submit" disabled={profilePending}>
              {profilePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.changePassword")}
          </CardTitle>
          <CardDescription>{t("settings.passwordTooShort")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handlePassword}>
            <div className="space-y-2">
              <Label htmlFor="current-password">
                {t("settings.currentPassword")}
              </Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                required
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("settings.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                minLength={8}
                required
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                {t("settings.confirmPassword")}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                minLength={8}
                required
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={passwordPending}>
              {passwordPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
