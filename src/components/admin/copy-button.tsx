"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function CopyButton({
  value,
  className,
  label,
  variant = "ghost",
  size = "icon-sm",
}: {
  value: string;
  className?: string;
  label?: string;
  variant?: "ghost" | "outline" | "secondary";
  size?: "icon-sm" | "sm";
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  async function handleCopy() {
    try {
      if (!(await copyText(value))) {
        setManual(true);
        return;
      }
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("common.operationFailed"));
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn(className)}
        onClick={() => void handleCopy()}
        aria-label={label ?? t("common.copy")}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {label ? <span className="ml-1.5">{label}</span> : null}
      </Button>
      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.copy")}</DialogTitle>
            <DialogDescription>{t("common.manualCopy")}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t("common.copy")}
            readOnly
            value={value}
            autoFocus
            onFocus={(event) => event.target.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
