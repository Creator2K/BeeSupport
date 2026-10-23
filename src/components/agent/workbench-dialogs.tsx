"use client";

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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { TransferTarget } from "./workbench-types";

type WorkbenchDialogsProps = {
  transferOpen: boolean;
  onTransferOpenChange: (open: boolean) => void;
  targetsLoading: boolean;
  targetsError: boolean;
  targets: TransferTarget[];
  actionPending: boolean;
  onRetryTargets: () => void;
  onTransfer: (targetId: string) => void;
  closeConfirmOpen: boolean;
  onCloseConfirmOpenChange: (open: boolean) => void;
  onConfirmClose: () => void;
};

export function WorkbenchDialogs({
  transferOpen,
  onTransferOpenChange,
  targetsLoading,
  targetsError,
  targets,
  actionPending,
  onRetryTargets,
  onTransfer,
  closeConfirmOpen,
  onCloseConfirmOpenChange,
  onConfirmClose,
}: WorkbenchDialogsProps) {
  const t = useT();

  return (
    <>
      <Dialog open={transferOpen} onOpenChange={onTransferOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("workbench.transferTitle")}</DialogTitle>
            <DialogDescription>{t("workbench.transferTo")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {targetsLoading ? (
              <p role="status">{t("common.loading")}</p>
            ) : targetsError ? (
              <Button variant="outline" onClick={onRetryTargets}>
                {t("common.retry")}
              </Button>
            ) : targets.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {t("common.empty")}
              </p>
            ) : (
              targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left"
                  disabled={actionPending}
                  onClick={() => onTransfer(target.id)}
                >
                  <span className="bg-muted flex size-7 items-center justify-center rounded-full text-[11px]">
                    {target.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {target.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-[11px]">
                      {target.email}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      target.status === "ONLINE"
                        ? "bg-emerald-500"
                        : target.status === "AWAY"
                          ? "bg-amber-500"
                          : "bg-zinc-400",
                    )}
                  />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={closeConfirmOpen}
        onOpenChange={onCloseConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workbench.close")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workbench.closeConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={(event) => {
                event.preventDefault();
                onConfirmClose();
              }}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
