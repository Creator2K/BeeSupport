"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import type {
  TransferTarget,
  WorkbenchMe,
} from "@/components/agent/workbench-types";
import type { SerializedConversation } from "@/lib/realtime/types";
import { listTransferTargetsAction } from "@/server/actions/agents";

export function useWorkbenchActions({
  activeId,
  upsertConversation,
  agentStatus,
  setAgentStatus,
}: {
  activeId: string | null;
  upsertConversation: (conversation: SerializedConversation) => void;
  agentStatus: WorkbenchMe["status"];
  setAgentStatus: (status: WorkbenchMe["status"]) => void;
}) {
  const t = useT();
  const [transferOpen, setTransferOpen] = useState(false);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const actionPendingRef = useRef(false);
  const [targets, setTargets] = useState<TransferTarget[]>([]);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [statusPending, setStatusPending] = useState(false);

  async function runAction(
    action: "claim" | "close" | "reopen" | "transfer",
    targetAgentId?: string,
  ): Promise<boolean> {
    if (!activeId || actionPendingRef.current) return false;
    actionPendingRef.current = true;
    setActionPending(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${activeId}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, targetAgentId }),
        },
      );
      const data = (await response.json()) as {
        conversation?: SerializedConversation;
        error?: string;
      };
      if (!response.ok) {
        toast.error(data.error ?? t("common.operationFailed"));
        return false;
      }
      if (data.conversation) upsertConversation(data.conversation);
      window.dispatchEvent(new Event("beesupport:followups-changed"));
      toast.success(
        action === "claim"
          ? t("workbench.claimed")
          : action === "close"
            ? t("conversations.statusClosed")
            : action === "transfer"
              ? t("workbench.transferDone")
              : t("workbench.reopen"),
      );
      return true;
    } catch {
      toast.error(t("common.operationFailed"));
      return false;
    } finally {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }

  async function openTransfer() {
    setTransferOpen(true);
    setTargets([]);
    setTargetsError(false);
    setTargetsLoading(true);
    try {
      setTargets(await listTransferTargetsAction());
    } catch {
      setTargetsError(true);
      toast.error(t("common.operationFailed"));
    } finally {
      setTargetsLoading(false);
    }
  }

  async function transferTo(agentId: string) {
    if (await runAction("transfer", agentId)) setTransferOpen(false);
  }

  async function changeStatus(status: WorkbenchMe["status"]) {
    if (statusPending) return;
    setStatusPending(true);
    try {
      const response = await fetch("/api/agent/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Status update failed");
      setAgentStatus(status);
      toast.success(
        status === "ONLINE"
          ? t("workbench.statusOnline")
          : status === "AWAY"
            ? t("workbench.statusAway")
            : t("workbench.statusOffline"),
      );
    } catch {
      toast.error(t("common.operationFailed"));
    } finally {
      setStatusPending(false);
    }
  }

  return {
    transferOpen,
    setTransferOpen,
    targetsLoading,
    targetsError,
    actionPending,
    targets,
    closeConfirmOpen,
    setCloseConfirmOpen,
    agentStatus,
    setAgentStatus,
    statusPending,
    runAction,
    openTransfer,
    transferTo,
    changeStatus,
  };
}