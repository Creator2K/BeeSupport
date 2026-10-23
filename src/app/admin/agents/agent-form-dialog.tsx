"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { createAgentAction, updateAgentAction } from "@/server/actions/agents";

import type { AgentRecord, AgentSiteOption } from "./agent-types";

type FormState = {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "AGENT";
  siteIds: string[];
  active: boolean;
};

function emptyForm(): FormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "AGENT",
    siteIds: [],
    active: true,
  };
}

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
  const t = useT();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      agent
        ? {
            name: agent.name,
            email: agent.email,
            password: "",
            role: agent.role,
            siteIds: agent.siteIds,
            active: agent.active,
          }
        : emptyForm(),
    );
  }, [open, agent]);

  function toggleSite(siteId: string) {
    setForm((prev) => ({
      ...prev,
      siteIds: prev.siteIds.includes(siteId)
        ? prev.siteIds.filter((id) => id !== siteId)
        : [...prev.siteIds, siteId],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = agent
      ? await callClientAction(
          () =>
            updateAgentAction(agent.id, {
              name: form.name,
              role: form.role,
              siteIds: form.siteIds,
              active: form.active,
            }),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () =>
            createAgentAction({
              name: form.name,
              email: form.email,
              password: form.password,
              role: form.role,
              siteIds: form.siteIds,
              active: form.active,
            }),
          t("common.operationFailed"),
        );

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(agent ? t("agents.updated") : t("agents.created"));
    onOpenChange(false);
    onSaved();
  }

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
          <div className="space-y-2">
            <Label htmlFor="agent-name">{t("agents.nameLabel")}</Label>
            <Input
              id="agent-name"
              value={form.name}
              required
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-email">{t("agents.emailLabel")}</Label>
            <Input
              id="agent-email"
              type="email"
              value={form.email}
              required
              disabled={Boolean(agent)}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </div>

          {!agent ? (
            <div className="space-y-2">
              <Label htmlFor="agent-password">
                {t("agents.passwordLabel")}
              </Label>
              <Input
                id="agent-password"
                type="text"
                value={form.password}
                minLength={8}
                required
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className="text-muted-foreground text-xs">
                {t("agents.passwordHint")}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>{t("agents.role")}</Label>
            <div className="flex gap-4">
              {(["AGENT", "ADMIN"] as const).map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="role"
                    className="accent-foreground size-3.5"
                    checked={form.role === role}
                    onChange={() => setForm((prev) => ({ ...prev, role }))}
                  />
                  {role === "ADMIN"
                    ? t("agents.roleAdmin")
                    : t("agents.roleAgent")}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("agents.roleHint")}
            </p>
          </div>

          {form.role === "AGENT" ? (
            <div className="space-y-2">
              <Label>{t("agents.assignedSites")}</Label>
              {sites.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("sites.noAgents")}
                </p>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  {sites.map((site) => (
                    <label
                      key={site.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={form.siteIds.includes(site.id)}
                        onCheckedChange={() => toggleSite(site.id)}
                      />
                      {site.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                {t("agents.selectSitesHint")}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground rounded-md border p-3 text-xs">
              {t("agents.allSitesHint")}
            </p>
          )}

          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">
              {t("agents.activeLabel")}
            </Label>
            <Switch
              checked={form.active}
              onCheckedChange={(value) =>
                setForm((prev) => ({ ...prev, active: value }))
              }
            />
          </div>

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
