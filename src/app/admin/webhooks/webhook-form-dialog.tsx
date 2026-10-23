"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { callClientAction } from "@/lib/client-action";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  createWebhookAction,
  updateWebhookAction,
} from "@/server/actions/webhooks";

import {
  EVENT_OPTIONS,
  LEGACY_TYPES,
  TYPE_LABELS,
  TYPE_ORDER,
  URL_HINTS,
  type SiteOption,
  type WebhookRecord,
} from "./webhook-types";

type WebhookFormDialogProps = {
  platform: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: WebhookRecord | null;
  sites: SiteOption[];
  onSaved: () => void;
};

export function WebhookFormDialog({
  open,
  onOpenChange,
  endpoint,
  sites,
  onSaved,
  platform,
}: WebhookFormDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<WebhookRecord["type"]>("GENERIC");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [siteId, setSiteId] = useState("__all__");
  const [active, setActive] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(endpoint?.name ?? "");
    setType(endpoint?.type ?? "GENERIC");
    setUrl(endpoint?.url ?? "");
    setSecret(endpoint?.secret ?? "");
    setEvents(endpoint?.events ?? []);
    setSiteId(endpoint?.siteId ?? "__all__");
    setActive(endpoint?.active ?? true);
  }, [open, endpoint]);

  function toggleEvent(value: string) {
    setEvents((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  }

  const isWechatBot = type === "WECHAT_BOT";
  const typeOptions = [
    ...TYPE_ORDER,
    ...(LEGACY_TYPES.includes(type) ? LEGACY_TYPES : []),
  ].filter(
    (option) => platform || (option !== "WECHAT_BOT" && option !== "WECHAT"),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = {
      name,
      type,
      url,
      secret: secret || null,
      events,
      siteId: siteId === "__all__" ? null : siteId,
      active,
    };

    const result = endpoint
      ? await callClientAction(
          () => updateWebhookAction(endpoint.id, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createWebhookAction(payload),
          t("common.operationFailed"),
        );

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(endpoint ? t("webhooks.updated") : t("webhooks.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {endpoint ? t("webhooks.editTitle") : t("webhooks.new")}
          </DialogTitle>
          <DialogDescription>{t("webhooks.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
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

          {error ? (
            <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
