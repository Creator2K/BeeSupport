"use client";

import { Loader2, Send } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type {
  WechatConfigView,
  WechatStateView,
} from "./wechat-login-types";

type WechatLoginConfigProps = {
  state: WechatStateView;
  config: WechatConfigView;
  defaultTo: string;
  testTo: string;
  busy: string | null;
  savingTo: boolean;
  onEnabledChange: (checked: boolean) => void;
  onDefaultToChange: (value: string) => void;
  onSaveDefaultTo: () => void;
  onTestToChange: (value: string) => void;
  onSendTest: () => void;
};

export function WechatLoginConfig({
  state,
  config,
  defaultTo,
  testTo,
  busy,
  savingTo,
  onEnabledChange,
  onDefaultToChange,
  onSaveDefaultTo,
  onTestToChange,
  onSendTest,
}: WechatLoginConfigProps) {
  const t = useT();

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <div className="space-y-0.5">
          <Label className="text-xs">{t("wechat.enabled")}</Label>
          <p className="text-muted-foreground text-[11px]">
            {t("wechat.enabledHint")}
          </p>
        </div>
        <Switch
          aria-label={t("wechat.enabled")}
          checked={config.enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("wechat.defaultTo")}</Label>
          <div className="flex gap-1.5">
            <Input
              value={defaultTo}
              onChange={(event) => onDefaultToChange(event.target.value)}
              placeholder={t("wechat.defaultToPlaceholder")}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={savingTo}
              onClick={onSaveDefaultTo}
            >
              {savingTo ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                t("common.save")
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("wechat.sendTest")}</Label>
          <div className="flex gap-1.5">
            <Input
              value={testTo}
              onChange={(event) => onTestToChange(event.target.value)}
              placeholder={t("wechat.toPlaceholder")}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "test" || state.status !== "online"}
              onClick={onSendTest}
            >
              {busy === "test" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span className="ml-1.5">{t("wechat.test")}</span>
            </Button>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-[11px]">
        {t("wechat.storageHint", { dir: state.storageDir })}
      </p>
    </>
  );
}
