"use client";

import type { Dispatch, SetStateAction } from "react";

import type { TranslateFn } from "@/lib/i18n/translate";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AgentFormState } from "./use-agent-form";
import type { AgentRecord, AgentSiteOption } from "./agent-types";

export function AgentFormFields({
  agent,
  form,
  setForm,
  toggleSite,
  sites,
  t,
}: {
  agent: AgentRecord | null;
  form: AgentFormState;
  setForm: Dispatch<SetStateAction<AgentFormState>>;
  toggleSite: (siteId: string) => void;
  sites: AgentSiteOption[];
  t: TranslateFn;
}) {
  return (
    <>
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
    </>
  );
}
