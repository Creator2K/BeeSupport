"use client";

import { useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { callClientAction } from "@/lib/client-action";
import type { EffectiveWidgetSettings } from "@/lib/branding";
import {
  createSiteAction,
  updateSiteAction,
} from "@/server/actions/sites";

import { SiteBrandingSection } from "./site-branding-section";
import { SiteFormFields } from "./site-form-fields";
import {
  buildSitePayload,
  emptySiteForm,
  parseSiteWorkHours,
  type SiteDayRange,
  type SiteFormState,
} from "./site-form-values";
import { SiteWorkHoursFields } from "./site-work-hours-fields";
import type { SiteRecord } from "./sites-client";

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
  const [form, setForm] = useState<SiteFormState>(emptySiteForm);
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
        ...parseSiteWorkHours(site.workHours),
      });
    } else {
      setForm(emptySiteForm());
    }
  }, [open, site]);

  function update<K extends keyof SiteFormState>(
    key: K,
    value: SiteFormState[K],
  ) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "primaryColor" || key === "position"
        ? { widgetSettings: { ...previous.widgetSettings, [key]: value } }
        : {}),
    }));
  }

  function updateDay(
    day: number,
    index: number,
    patch: Partial<SiteDayRange>,
  ) {
    setForm((previous) => ({
      ...previous,
      days: {
        ...previous.days,
        [day]: (previous.days[day] ?? []).map((range, position) =>
          position === index ? { ...range, ...patch } : range,
        ),
      },
    }));
  }

  function addDayRange(day: number) {
    setForm((previous) => ({
      ...previous,
      days: {
        ...previous.days,
        [day]: [
          ...(previous.days[day] ?? []),
          { start: "09:00", end: "18:00" },
        ],
      },
    }));
  }

  function removeDayRange(day: number, index: number) {
    setForm((previous) => ({
      ...previous,
      days: {
        ...previous.days,
        [day]: (previous.days[day] ?? []).filter(
          (_, position) => position !== index,
        ),
      },
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = buildSitePayload(form);
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
          <SiteFormFields form={form} update={update} />
          <Separator />
          <SiteWorkHoursFields
            form={form}
            update={update}
            updateDay={updateDay}
            addDayRange={addDayRange}
            removeDayRange={removeDayRange}
          />
          <Separator />
          <SiteBrandingSection
            form={form}
            site={site}
            defaultSettings={defaultSettings}
            canCustomizeFooter={canCustomizeFooter}
            update={update}
          />

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
