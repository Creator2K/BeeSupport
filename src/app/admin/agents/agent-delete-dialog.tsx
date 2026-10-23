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
import { deleteAgentAction } from "@/server/actions/agents";

import type { AgentRecord } from "./agent-types";

export function AgentDeleteDialog({
  agent,
  onClose,
  onDeleted,
}: {
  agent: AgentRecord;
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
        () => deleteAgentAction(agent.id),
        t("common.operationFailed"),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("agents.deleted"));
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
            {t("agents.deleteConfirm")}
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
