"use client";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  SITE_WEEKDAYS,
  type SiteDayRange,
  type SiteFormState,
  type UpdateSiteForm,
} from "./site-form-values";

export function SiteWorkHoursFields({
  form,
  update,
  updateDay,
  addDayRange,
  removeDayRange,
}: {
  form: SiteFormState;
  update: UpdateSiteForm;
  updateDay: (day: number, index: number, patch: Partial<SiteDayRange>) => void;
  addDayRange: (day: number) => void;
  removeDayRange: (day: number, index: number) => void;
}) {
  const t = useT();

  return (
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
            {SITE_WEEKDAYS.map((day) => (
              <div key={day.value} className="space-y-2 rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs">{day.zh}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={(form.days[day.value]?.length ?? 0) >= 12}
                    onClick={() => addDayRange(day.value)}
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
                      onClick={() => removeDayRange(day.value, index)}
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
  );
}
