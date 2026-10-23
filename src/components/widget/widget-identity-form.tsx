"use client";

import { Loader2 } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { SiteConfig } from "./widget-types";

type WidgetIdentityFormProps = {
  config: SiteConfig | null;
  online: boolean;
  email: string;
  name: string;
  formError: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function WidgetIdentityForm({
  config,
  online,
  email,
  name,
  formError,
  submitting,
  onEmailChange,
  onNameChange,
  onSubmit,
}: WidgetIdentityFormProps) {
  const t = useT();

  return (
    <form
      className="flex flex-1 flex-col gap-4 overflow-y-auto p-5"
      onSubmit={onSubmit}
    >
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold">{t("widget.startFormTitle")}</h1>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {config?.offlineMessage && !online
            ? config.offlineMessage
            : t("widget.startFormHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="visitor-email" className="text-xs">
          {t("widget.emailLabel")}
          {config?.requireEmail ? (
            <span className="text-destructive ml-0.5">*</span>
          ) : null}
        </Label>
        <Input
          id="visitor-email"
          type="email"
          required={config?.requireEmail ?? true}
          value={email}
          placeholder={t("widget.emailPlaceholder")}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="visitor-name" className="text-xs">
          {t("widget.nameLabel")}
        </Label>
        <Input
          id="visitor-name"
          value={name}
          placeholder={t("widget.namePlaceholder")}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>

      {formError ? (
        <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("widget.starting")}
          </>
        ) : (
          t("widget.start")
        )}
      </Button>

      <p className="text-muted-foreground mt-auto text-center text-[11px]">
        {t("widget.poweredBy")}
      </p>
    </form>
  );
}
