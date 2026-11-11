"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { callClientAction } from "@/lib/client-action";
import {
  deleteWebhookAction,
  testWebhookAction,
  toggleWebhookAction,
} from "@/server/actions/webhooks";

import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookList } from "./webhook-list";
import type {
  SiteOption,
  WebhookRecord,
} from "./webhook-types";

export type { SiteOption, WebhookRecord } from "./webhook-types";

export function WebhooksClient({
  endpoints,
  sites,
  platform = false,
}: {
  platform?: boolean;
  endpoints: WebhookRecord[];
  sites: SiteOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookRecord | null>(null);
  const [deleting, setDeleting] = useState<WebhookRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function handleToggle(endpoint: WebhookRecord, active: boolean) {
    const result = await callClientAction(
      () => toggleWebhookAction(endpoint.id, active),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleTest(endpoint: WebhookRecord) {
    setTestingId(endpoint.id);
    const result = await callClientAction(
      () =>
        testWebhookAction({
          id: endpoint.id,
          type: endpoint.type,
          url: endpoint.url,
          siteId: endpoint.siteId,
        }),
      t("common.operationFailed"),
    );
    setTestingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("webhooks.testSuccess"));
    router.refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteWebhookAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("webhooks.deleted"));
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <WebhookList
        endpoints={endpoints}
        testingId={testingId}
        onNew={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(endpoint) => {
          setEditing(endpoint);
          setFormOpen(true);
        }}
        onTest={(endpoint) => void handleTest(endpoint)}
        onDelete={setDeleting}
        onToggle={(endpoint, active) => void handleToggle(endpoint, active)}
      />

      <WebhookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        endpoint={editing}
        sites={sites}
        platform={platform}
        onSaved={() => router.refresh()}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("common.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
