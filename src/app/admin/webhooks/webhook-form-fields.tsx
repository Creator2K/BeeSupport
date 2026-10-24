"use client";

import { useT } from "@/components/locale-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  EVENT_OPTIONS,
  TYPE_LABELS,
  URL_HINTS,
  type SiteOption,
  type WebhookRecord,
} from "./webhook-types";

export function WebhookFormFields({
  name,
  type,
  url,
  secret,
  events,
  siteId,
  active,
  sites,
  isWechatBot,
  typeOptions,
  setName,
  setType,
  setUrl,
  setSecret,
  setSiteId,
  setActive,
  toggleEvent,
}: {
  name: string;
  type: WebhookRecord["type"];
  url: string;
  secret: string;
  events: string[];
  siteId: string;
  active: boolean;
  sites: SiteOption[];
  isWechatBot: boolean;
  typeOptions: WebhookRecord["type"][];
  setName: (value: string) => void;
  setType: (value: WebhookRecord["type"]) => void;
  setUrl: (value: string) => void;
  setSecret: (value: string) => void;
  setSiteId: (value: string) => void;
  setActive: (value: boolean) => void;
  toggleEvent: (value: string) => void;
}) {
  const t = useT();
  return (
    <>
          <div className="space-y-2">
            <Label htmlFor="webhook-name">{t("common.name")}</Label>
            <Input
              id="webhook-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("webhooks.typeLabel")}</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as WebhookRecord["type"])}
            >
              <SelectTrigger aria-label={t("webhooks.typeLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(TYPE_LABELS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">
              {isWechatBot
                ? t("webhooks.wechatTargetLabel")
                : t("webhooks.urlLabel")}
            </Label>
            <Input
              id="webhook-url"
              value={url}
              required={!isWechatBot}
              placeholder={t(URL_HINTS[type])}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-muted-foreground font-mono text-[11px] break-all">
              {t(URL_HINTS[type])}
            </p>
            {isWechatBot ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("webhooks.wechatInternalHint")}{" "}
                <a
                  href="#wechat-login"
                  className="underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    document
                      .getElementById("wechat-login")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {t("webhooks.wechatGoLogin")}
                </a>
              </p>
            ) : null}
            {type === "WECHAT" ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("webhooks.wechatBridgeHint")}
              </p>
            ) : null}
          </div>

          {type === "GENERIC" ? (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">
                {t("webhooks.secretLabel")}
              </Label>
              <Input
                id="webhook-secret"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("webhooks.secretHint")}
              </p>
            </div>
          ) : null}

          {type === "WECHAT" ? (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">
                {t("webhooks.secretLabel")}
              </Label>
              <Input
                id="webhook-secret"
                value={secret}
                placeholder={t("webhooks.secretHint")}
                onChange={(event) => setSecret(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("webhooks.secretHint")}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>{t("webhooks.eventsLabel")}</Label>
            <div className="space-y-2 rounded-md border p-3">
              {EVENT_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={events.includes(option.value)}
                    onCheckedChange={() => toggleEvent(option.value)}
                  />
                  {t(option.labelKey)}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("webhooks.eventsHint")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("webhooks.siteScope")}</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger aria-label={t("webhooks.siteScope")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("webhooks.siteScopeAll")}
                  </SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-3 pb-1.5">
              <Label className="text-sm font-normal">
                {t("common.enabled")}
              </Label>
              <Switch
                checked={active}
                onCheckedChange={setActive}
                aria-label={t("common.enabled")}
              />
            </div>
          </div>
    </>
  );
}
