"use client";

import { Globe } from "lucide-react";

import { CopyButton } from "@/components/admin/copy-button";
import { useT } from "@/components/locale-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { SiteRecord } from "./site-types";

export function siteEmbedSnippet(site: SiteRecord, appUrl: string) {
  return `<script src="${appUrl.replace(/\/$/, "")}/widget.js?key=${site.publicKey}" async></script>`;
}

export function SiteEmbedDialog({
  appUrl,
  site,
  onClose,
}: {
  appUrl: string;
  site: SiteRecord | null;
  onClose: () => void;
}) {
  const t = useT();
  const snippet = site ? siteEmbedSnippet(site, appUrl) : "";

  return (
    <Dialog open={Boolean(site)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sites.embedCode")}</DialogTitle>
          <DialogDescription>
            {t("sites.embedHint")} · {site?.name}
          </DialogDescription>
        </DialogHeader>

        {site ? (
          <div className="min-w-0 space-y-3">
            <pre className="bg-muted max-h-40 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
              {snippet}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                <Globe className="size-3.5 shrink-0" />
                <span className="truncate">
                  {site.allowedOrigins.length === 0
                    ? t("sites.allowedOriginsFree")
                    : site.allowedOrigins.join("、")}
                </span>
              </div>
              <CopyButton
                value={snippet}
                label={t("common.copy")}
                variant="secondary"
                size="sm"
                className="shrink-0"
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
