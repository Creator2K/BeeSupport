"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callClientAction } from "@/lib/client-action";
import { resetAgentPasswordAction } from "@/server/actions/agents";

import type { AgentRecord } from "./agent-types";

export function AgentResetPasswordDialog({
  agent,
  onClose,
  onDone,
}: {
  agent: AgentRecord | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent) return;
    setPending(true);
    const result = await callClientAction(
      () => resetAgentPasswordAction(agent.id, password),
      t("common.operationFailed"),
    );
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("agents.resetDone"));
    setPassword("");
    onDone();
  }

  return (
    <Dialog open={Boolean(agent)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("agents.resetPassword")}</DialogTitle>
          <DialogDescription>{agent?.email}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">{t("agents.newPassword")}</Label>
            <Input
              id="reset-password"
              type="text"
              value={password}
              minLength={8}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
