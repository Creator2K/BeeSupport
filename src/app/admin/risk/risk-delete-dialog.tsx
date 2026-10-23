"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { deleteRiskRuleAction } from "@/server/actions/risk";

import type { RiskRule } from "./risk-types";

export function RiskDeleteDialog({
  rule,
  onClose,
  onDeleted,
}: {
  rule: RiskRule;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      const result = await callClientAction(
        () => deleteRiskRuleAction(rule.id),
        "操作失败，请重试",
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      onDeleted(rule.id);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这条规则？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后将停止拦截，已有拦截记录会保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={onClose}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
