"use client";

import { callClientAction } from "@/lib/client-action";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { AccountSettings } from "@/components/account-settings";
import { AccountPolicy } from "./account-policy";
import {
  saveSmtpAction,
  sendTestMailAction,
  testSmtpAction,
} from "@/server/actions/settings";

export type SmtpFormState = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function SettingsClient({
  user,
  smtp,
  accountPolicy,
  smtpReady,
}: {
  user: { name: string; email: string; locale: string };
  smtp: SmtpFormState | null;
  accountPolicy: { requireEmailVerification: boolean };
  smtpReady: boolean;
}) {
  const t = useT();
  const router = useRouter();

  const [smtpForm, setSmtpForm] = useState<SmtpFormState>(
    smtp ?? {
      host: "",
      port: 465,
      secure: true,
      user: "",
      pass: "",
      from: "",
    },
  );
  const [smtpPending, setSmtpPending] = useState<"save" | "test" | null>(null);
  const [testTo, setTestTo] = useState(user.email);

  function updateSmtp<K extends keyof SmtpFormState>(
    key: K,
    value: SmtpFormState[K],
  ) {
    setSmtpForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveSmtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSmtpPending("save");
    const result = await callClientAction(
      () => saveSmtpAction(smtpForm),
      t("common.operationFailed"),
    );
    setSmtpPending(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.smtpSaved"));
    router.refresh();
  }

  async function handleTestSmtp() {
    setSmtpPending("test");
    const result = await callClientAction(
      () => testSmtpAction(smtpForm),
      t("common.operationFailed"),
    );
    setSmtpPending(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.smtpTestOk"));
    router.refresh();
  }

  async function handleSendTestMail() {
    const result = await callClientAction(
      () => sendTestMailAction(testTo),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.smtpTestMailSent"));
  }

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Card className="shadow-none lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t("settings.smtp")}</CardTitle>
          <CardDescription>{t("settings.smtpHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSaveSmtp}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp-host">{t("settings.smtpHost")}</Label>
                <Input
                  id="smtp-host"
                  value={smtpForm.host}
                  placeholder="smtp.example.com"
                  onChange={(event) => updateSmtp("host", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-port">{t("settings.smtpPort")}</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={smtpForm.port}
                  onChange={(event) =>
                    updateSmtp("port", Number(event.target.value) || 465)
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp-user">{t("settings.smtpUser")}</Label>
                <Input
                  id="smtp-user"
                  value={smtpForm.user}
                  onChange={(event) => updateSmtp("user", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-pass">{t("settings.smtpPass")}</Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  value={smtpForm.pass}
                  onChange={(event) => updateSmtp("pass", event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-from">{t("settings.smtpFrom")}</Label>
              <Input
                id="smtp-from"
                value={smtpForm.from}
                placeholder="BeeSupport <noreply@example.com>"
                onChange={(event) => updateSmtp("from", event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal">
                {t("settings.smtpSecure")}
              </Label>
              <Switch
                aria-label={t("settings.smtpSecure")}
                checked={smtpForm.secure}
                onCheckedChange={(value) => updateSmtp("secure", value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={smtpPending !== null}>
                {smtpPending === "save" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("common.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={smtpPending !== null}
                onClick={() => void handleTestSmtp()}
              >
                {smtpPending === "test" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("settings.smtpTest")}
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="min-w-56 flex-1 space-y-2">
                <Label htmlFor="smtp-test-to">{t("settings.smtpTestTo")}</Label>
                <Input
                  id="smtp-test-to"
                  type="email"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleSendTestMail()}
              >
                <MailCheck className="size-4" />
                <span className="ml-1.5">{t("settings.smtpSendTest")}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AccountPolicy
        required={accountPolicy.requireEmailVerification}
        smtpReady={smtpReady}
      />
      <AccountSettings user={user} />
    </div>
  );
}
