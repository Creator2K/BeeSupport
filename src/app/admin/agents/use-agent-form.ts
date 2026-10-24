"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { callClientAction } from "@/lib/client-action";
import { useT } from "@/components/locale-provider";
import {
  createAgentAction,
  updateAgentAction,
} from "@/server/actions/agents";
import type { AgentRecord } from "./agent-types";

export type AgentFormState = {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "AGENT";
  siteIds: string[];
  active: boolean;
};

export function emptyAgentForm(): AgentFormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "AGENT",
    siteIds: [],
    active: true,
  };
}

export function useAgentForm({
  open,
  agent,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  agent: AgentRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<AgentFormState>(emptyAgentForm);
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
        : emptyAgentForm(),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

  return {
    t,
    form,
    setForm,
    pending,
    error,
    toggleSite,
    handleSubmit,
  };
}
