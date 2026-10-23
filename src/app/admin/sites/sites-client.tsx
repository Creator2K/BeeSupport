"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { callClientAction } from "@/lib/client-action";
import type { EffectiveWidgetSettings } from "@/lib/branding";
import { toggleSiteActiveAction } from "@/server/actions/sites";

import { SiteDeleteDialog } from "./site-delete-dialog";
import { SiteEmbedDialog } from "./site-embed-dialog";
import { SiteFormDialog } from "./site-form-dialog";
import { SiteTable } from "./site-table";
import type { SiteRecord } from "./site-types";

export type { SiteRecord } from "./site-types";

export function SitesClient({
  sites,
  appUrl,
  defaultSettings,
  canCustomizeFooter = true,
}: {
  defaultSettings: EffectiveWidgetSettings;
  canCustomizeFooter?: boolean;
  sites: SiteRecord[];
  appUrl: string;
}) {
  const t = useT();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRecord | null>(null);
  const [embedSite, setEmbedSite] = useState<SiteRecord | null>(null);
  const [deleting, setDeleting] = useState<SiteRecord | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleToggle(site: SiteRecord, active: boolean) {
    setPendingId(site.id);
    const result = await callClientAction(
      () => toggleSiteActiveAction(site.id, active),
      t("common.operationFailed"),
    );
    setPendingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(active ? t("common.enabled") : t("common.disabled"));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <SiteTable
        sites={sites}
        pendingId={pendingId}
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(site) => {
          setEditing(site);
          setFormOpen(true);
        }}
        onToggle={(site, active) => void handleToggle(site, active)}
        onEmbed={setEmbedSite}
        onDelete={setDeleting}
      />

      <SiteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        site={editing}
        defaultSettings={defaultSettings}
        canCustomizeFooter={canCustomizeFooter}
        onSaved={() => router.refresh()}
      />

      <SiteEmbedDialog
        appUrl={appUrl}
        site={embedSite}
        onClose={() => setEmbedSite(null)}
      />

      {deleting && (
        <SiteDeleteDialog
          key={deleting.id}
          site={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
