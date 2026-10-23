"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createSiteAction,
  updateSiteAction,
  type SiteInput,
} from "@/server/actions/sites";

import { BrandingEditor } from "@/components/admin/branding-editor";
import type { WidgetSettings, EffectiveWidgetSettings } from "@/lib/branding";
import type { SiteRecord } from "./sites-client";

const WEEKDAYS = [
  { value: 1, zh: "周一", en: "Mon" },
  { value: 2, zh: "周二", en: "Tue" },
  { value: 3, zh: "周三", en: "Wed" },
  { value: 4, zh: "周四", en: "Thu" },
  { value: 5, zh: "周五", en: "Fri" },
  { value: 6, zh: "周六", en: "Sat" },
  { value: 0, zh: "周日", en: "Sun" },
];

type DayRange = { start: string; end: string };

type FormState = {
  widgetSettings: WidgetSettings;
  name: string;
  slug: string;
  description: string;
  primaryColor: string;
  position: "right" | "left";
  welcomeMessage: string;
  offlineMessage: string;
  requireEmail: boolean;
  autoAssign: boolean;
  imageReviewEnabled: boolean;
  active: boolean;
  notifyEmail: string;
  allowedOrigins: string;
  workHoursEnabled: boolean;
  workHoursTimezone: string;
  days: Record<number, DayRange[]>;
};

const DEFAULT_WELCOME = "你好！有什么可以帮你的吗？";
const DEFAULT_OFFLINE =
  "当前客服不在线，请留下你的邮箱和问题，我们会尽快回复。";

function emptyForm(): FormState {
  return {
    widgetSettings: {},
    name: "",
    slug: "",
    description: "",
    primaryColor: "#18181b",
    position: "right",
    welcomeMessage: DEFAULT_WELCOME,
    offlineMessage: DEFAULT_OFFLINE,
    requireEmail: true,
    autoAssign: true,
    imageReviewEnabled: false,
    active: true,
    notifyEmail: "",
    allowedOrigins: "",
    workHoursEnabled: false,
    workHoursTimezone: "Asia/Shanghai",
    days: {},
  };
}

function parseWorkHours(
  value: unknown,
): Pick<FormState, "workHoursEnabled" | "workHoursTimezone" | "days"> {
  const config = (value ?? null) as {
    enabled?: boolean;
    timezone?: string;
    days?: Record<string, [string, string][]>;
  } | null;

  const days: Record<number, DayRange[]> = {};
  for (const [key, ranges] of Object.entries(config?.days ?? {})) {
    if (Array.isArray(ranges))
      days[Number(key)] = ranges.map(([start, end]) => ({ start, end }));
  }

  return {
    workHoursEnabled: Boolean(config?.enabled),
    workHoursTimezone: config?.timezone ?? "Asia/Shanghai",
    days,
  };
}

export function SiteFormDialog({
  open,
  onOpenChange,
  site,
  onSaved,
  defaultSettings,
  canCustomizeFooter = true,
}: {
  defaultSettings: EffectiveWidgetSettings;
  canCustomizeFooter?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteRecord | null;
  onSaved: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (site) {
      setForm({
        widgetSettings: site.widgetSettings,
        name: site.name,
        slug: site.slug,
        description: site.description ?? "",
        primaryColor: site.primaryColor,
        position: site.position === "left" ? "left" : "right",
        welcomeMessage: site.welcomeMessage,
        offlineMessage: site.offlineMessage,
        requireEmail: site.requireEmail,
        autoAssign: site.autoAssign,
        imageReviewEnabled: site.imageReviewEnabled,
        active: site.active,
        notifyEmail: site.notifyEmail ?? "",
        allowedOrigins: site.allowedOrigins.join("\n"),
        ...parseWorkHours(site.workHours),
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, site]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "primaryColor" || key === "position"
        ? { widgetSettings: { ...prev.widgetSettings, [key]: value } }
        : {}),
    }));
  }

  function updateDay(day: number, index: number, patch: Partial<DayRange>) {
    setForm((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [day]: (prev.days[day] ?? []).map((range, i) =>
          i === index ? { ...range, ...patch } : range,
        ),
      },
    }));
  }

  function buildPayload(): SiteInput {
    const days: Record<string, [string, string][]> = {};
    for (const [day, ranges] of Object.entries(form.days)) {
      days[day] = ranges.map((range) => [range.start, range.end]);
    }

    return {
      widgetSettings: form.widgetSettings,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      primaryColor: form.primaryColor,
      position: form.position,
      welcomeMessage: form.welcomeMessage,
      offlineMessage: form.offlineMessage,
      requireEmail: form.requireEmail,
      autoAssign: form.autoAssign,
      imageReviewEnabled: form.imageReviewEnabled,
      active: form.active,
      notifyEmail: form.notifyEmail || null,
      allowedOrigins: form.allowedOrigins
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      workHours: {
        enabled: form.workHoursEnabled,
        timezone: form.workHoursTimezone,
        days,
      },
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = buildPayload();
    const result = site
      ? await callClientAction(
          () => updateSiteAction(site.id, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createSiteAction(payload),
          t("common.operationFailed"),
        );

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(site ? t("sites.updated") : t("sites.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {site ? t("sites.editTitle") : t("sites.new")}
          </DialogTitle>
          <DialogDescription>{t("sites.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="site-name">{t("sites.nameLabel")}</Label>
              <Input
                id="site-name"
                value={form.name}
                required
                onChange={(event) => update("name", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-slug">{t("sites.slugLabel")}</Label>
              <Input
                id="site-slug"
                value={form.slug}
                required
                placeholder="demo"
                onChange={(event) => update("slug", event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("sites.slugHint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-desc">{t("sites.description")}</Label>
            <Input
              id="site-desc"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="site-color">{t("sites.primaryColor")}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="site-color"
                  type="color"
                  value={form.primaryColor}
                  onChange={(event) =>
                    update("primaryColor", event.target.value)
                  }
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <Input
                  value={form.primaryColor}
                  onChange={(event) =>
                    update("primaryColor", event.target.value)
                  }
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("sites.position")}</Label>
              <Select
                value={form.position}
                onValueChange={(value) =>
                  update("position", value === "left" ? "left" : "right")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">
                    {t("sites.positionRight")}
                  </SelectItem>
                  <SelectItem value="left">
                    {t("sites.positionLeft")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-welcome">{t("sites.welcomeMessage")}</Label>
            <Textarea
              id="site-welcome"
              rows={2}
              value={form.welcomeMessage}
              onChange={(event) => update("welcomeMessage", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-offline">{t("sites.offlineMessage")}</Label>
            <Textarea
              id="site-offline"
              rows={2}
              value={form.offlineMessage}
              onChange={(event) => update("offlineMessage", event.target.value)}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <ToggleRow
              label={t("sites.requireEmail")}
              checked={form.requireEmail}
              onChange={(value) => update("requireEmail", value)}
            />
            <ToggleRow
              label={t("sites.autoAssign")}
              checked={form.autoAssign}
              onChange={(value) => update("autoAssign", value)}
            />
            <ToggleRow
              label={t("sites.imageReview")}
              checked={form.imageReviewEnabled}
              onChange={(value) => update("imageReviewEnabled", value)}
            />
            <ToggleRow
              label={t("sites.active")}
              checked={form.active}
              onChange={(value) => update("active", value)}
            />
          </div>

          <p className="text-xs leading-6 text-muted-foreground">
            {t("sites.imageReviewHint")}
          </p>
          <div className="space-y-2">
            <Label htmlFor="site-notify">{t("sites.notifyEmail")}</Label>
            <Input
              id="site-notify"
              type="email"
              value={form.notifyEmail}
              placeholder="support@example.com"
              onChange={(event) => update("notifyEmail", event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t("sites.notifyEmailHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-origins">{t("sites.allowedOrigins")}</Label>
            <Textarea
              id="site-origins"
              rows={3}
              value={form.allowedOrigins}
              placeholder={"example.com\n*.example.com"}
              onChange={(event) => update("allowedOrigins", event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t("sites.allowedOriginsHint")}
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal">
                {t("sites.workHoursEnabled")}
              </Label>
              <Switch
                checked={form.workHoursEnabled}
                onCheckedChange={(value) => update("workHoursEnabled", value)}
              />
            </div>

            {form.workHoursEnabled ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <Label className="w-24 shrink-0 text-xs">
                    {t("sites.workHoursTimezone")}
                  </Label>
                  <Input
                    value={form.workHoursTimezone}
                    onChange={(event) =>
                      update("workHoursTimezone", event.target.value)
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-2">
                  {WEEKDAYS.map((day) => (
                    <div
                      key={day.value}
                      className="space-y-2 rounded border p-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs">{day.zh}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={(form.days[day.value]?.length ?? 0) >= 12}
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              days: {
                                ...prev.days,
                                [day.value]: [
                                  ...(prev.days[day.value] ?? []),
                                  { start: "09:00", end: "18:00" },
                                ],
                              },
                            }))
                          }
                        >
                          {t("sites.addTimeRange")}
                        </Button>
                      </div>
                      {(form.days[day.value] ?? []).map((range, index) => (
                        <div
                          key={index}
                          className="flex min-w-0 items-center gap-2"
                        >
                          <Input
                            type="time"
                            required
                            aria-label={`${day.zh} ${index + 1} start`}
                            value={range.start}
                            onChange={(event) =>
                              updateDay(day.value, index, {
                                start: event.target.value,
                              })
                            }
                            className="h-8 min-w-0 flex-1 text-xs"
                          />
                          <span>-</span>
                          <Input
                            type="time"
                            required
                            aria-label={`${day.zh} ${index + 1} end`}
                            value={range.end}
                            onChange={(event) =>
                              updateDay(day.value, index, {
                                end: event.target.value,
                              })
                            }
                            className="h-8 min-w-0 flex-1 text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                days: {
                                  ...prev.days,
                                  [day.value]: (
                                    prev.days[day.value] ?? []
                                  ).filter((_, i) => i !== index),
                                },
                              }))
                            }
                          >
                            {t("common.delete")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("sites.workHoursHint")}
                </p>
              </div>
            ) : null}
          </div>

          <Separator />
          <section className="space-y-3">
            <h3 className="text-sm font-medium">访客窗口品牌与功能</h3>
            <BrandingEditor
              canCustomizeFooter={
                site?.canCustomizeFooter ?? canCustomizeFooter
              }
              value={form.widgetSettings}
              inherited={site?.inheritedSettings ?? defaultSettings}
              onChange={(value) => update("widgetSettings", value)}
            />
          </section>

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

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
