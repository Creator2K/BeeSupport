"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";

export function ImageApproval({ attachmentId }: { attachmentId: string }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [approved, setApproved] = useState(false);
  if (approved)
    return (
      <p className="flex items-center gap-1 text-xs opacity-80">
        <Check className="size-3" />
        {t("images.allowed")}
      </p>
    );
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full bg-background text-foreground"
      disabled={pending}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          const response = await fetch(
            `/api/agent/attachments/${attachmentId}/approve`,
            { method: "POST" },
          );
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || t("common.operationFailed"));
          setApproved(true);
          toast.success(
            t(data.changed ? "images.allowed" : "images.processed"),
          );
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : t("common.operationFailed"),
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {pending && <Loader2 className="size-3 animate-spin" />}
      {t("images.allowNext")}
    </Button>
  );
}
