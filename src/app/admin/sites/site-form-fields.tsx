"use client";

import { useId } from "react";

import { useT } from "@/components/locale-provider";
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

import type { SiteFormState, UpdateSiteForm } from "./site-form-values";

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

export function SiteFormFields({
  form,
  update,
}: {
  form: SiteFormState;
  update: UpdateSiteForm;
}) {
  const t = useT();

  return (
    <>
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
              <SelectItem value="left">{t("sites.positionLeft")}</SelectItem>
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
    </>
  );
}
