"use client";

import { Loader2 } from "lucide-react";

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
import type { SiteOption, WebhookRecord } from "./webhook-types";
import { WebhookFormFields } from "./webhook-form-fields";
import { useWebhookForm } from "./use-webhook-form";

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
  const form = useWebhookForm({
    platform,
    open,
    endpoint,
    onOpenChange,
    onSaved,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {endpoint ? t("webhooks.editTitle") : t("webhooks.new")}
          </DialogTitle>
          <DialogDescription>{t("webhooks.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit}>
          <WebhookFormFields
            name={form.name}
            type={form.type}
            url={form.url}
            secret={form.secret}
            secretKept={form.secretKept}
            clearSecret={form.clearSecret}
            events={form.events}
            siteId={form.siteId}
            active={form.active}
            sites={sites}
            isWechatBot={form.isWechatBot}
            typeOptions={form.typeOptions}
            setName={form.setName}
            setType={form.setType}
            setUrl={form.setUrl}
            setSecret={form.setSecret}
            setClearSecret={form.setClearSecret}
            setSiteId={form.setSiteId}
            setActive={form.setActive}
            toggleEvent={form.toggleEvent}
          />

          {form.error ? (
            <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
              {form.error}
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
            <Button type="submit" disabled={form.pending}>
              {form.pending ? (
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
