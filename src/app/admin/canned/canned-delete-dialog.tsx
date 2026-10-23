"use client";

import { useState } from "react";
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
import { deleteCannedAction } from "@/server/actions/canned";

import type { CannedRecord } from "./canned-types";

export function CannedDeleteDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: CannedRecord;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    try {
      const result = await callClientAction(
        () => deleteCannedAction(item.id),
        t("common.operationFailed"),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("canned.deleted"));
      onDeleted();
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("common.deleteConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={onClose}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
          >
            {t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
