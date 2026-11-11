"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { callClientAction } from "@/lib/client-action";
import {
  createWebhookAction,
  updateWebhookAction,
} from "@/server/actions/webhooks";
import {
  LEGACY_TYPES,
  TYPE_ORDER,
  type WebhookRecord,
} from "./webhook-types";

export function useWebhookForm({
  platform,
  open,
  endpoint,
  onOpenChange,
  onSaved,
}: {
  platform: boolean;
  open: boolean;
  endpoint: WebhookRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<WebhookRecord["type"]>("GENERIC");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [siteId, setSiteId] = useState("__all__");
  const [active, setActive] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(endpoint?.name ?? "");
    setType(endpoint?.type ?? "GENERIC");
    setUrl(endpoint?.url ?? "");
    setSecret("");
    setClearSecret(false);
    setEvents(endpoint?.events ?? []);
    setSiteId(endpoint?.siteId ?? "__all__");
    setActive(endpoint?.active ?? true);
  }, [open, endpoint]);

  function toggleEvent(value: string) {
    setEvents((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  }

  const isWechatBot = type === "WECHAT_BOT";
  const typeOptions = [
    ...TYPE_ORDER,
    ...(LEGACY_TYPES.includes(type) ? LEGACY_TYPES : []),
  ].filter(
    (option) => platform || (option !== "WECHAT_BOT" && option !== "WECHAT"),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = {
      name,
      type,
      url,
      secret: secret || null,
      clearSecret,
      events,
      siteId: siteId === "__all__" ? null : siteId,
      active,
    };

    const result = endpoint
      ? await callClientAction(
          () => updateWebhookAction(endpoint.id, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createWebhookAction(payload),
          t("common.operationFailed"),
        );

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(endpoint ? t("webhooks.updated") : t("webhooks.created"));
    onOpenChange(false);
    onSaved();
  }

  return {
    name,
    setName,
    type,
    setType,
    url,
    setUrl,
    secret,
    setSecret,
    secretKept: Boolean(endpoint?.secretSet) && endpoint?.type === type,
    clearSecret,
    setClearSecret,
    events,
    toggleEvent,
    siteId,
    setSiteId,
    active,
    setActive,
    pending,
    error,
    isWechatBot,
    typeOptions,
    handleSubmit,
  };
}
