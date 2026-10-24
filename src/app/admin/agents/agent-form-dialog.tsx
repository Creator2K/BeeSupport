"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentFormFields } from "./agent-form-fields";
import { useAgentForm } from "./use-agent-form";
import type { AgentRecord, AgentSiteOption } from "./agent-types";

export function AgentFormDialog({
  open,
  onOpenChange,
  agent,
  sites,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentRecord | null;
  sites: AgentSiteOption[];
  onSaved: () => void;
}) {
  const {
    t,
    form,
    setForm,
    pending,
    error,
    toggleSite,
    handleSubmit,
  } = useAgentForm({ open, agent, onOpenChange, onSaved });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {agent ? t("agents.editTitle") : t("agents.new")}
          </DialogTitle>
          <DialogDescription>{t("agents.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <AgentFormFields
            agent={agent}
            form={form}
            setForm={setForm}
            toggleSite={toggleSite}
            sites={sites}
            t={t}
          />
          {error ? (
            <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
