"use client";

import type { Dispatch, SetStateAction } from "react";

import { useT } from "@/components/locale-provider";
import type {
  Availability,
  SiteConfig,
} from "@/components/widget/widget-types";
import { mergeMessages } from "@/lib/realtime/messages";
import type { VisitorEnv } from "@/lib/visitor-env";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

import type { StoredIdentity } from "./use-widget-tracking";
import { fetchWidgetState } from "./widget-session-api";
import { useWidgetSessionBootstrap } from "./use-widget-session-bootstrap";
import type {
  PageState,
  WidgetChatMode,
} from "./use-widget-session-state";

export function useWidgetSessionActions({
  siteKey,
  embedToken,
  pageUrl,
  referrer,
  page,
  collectEnv,
  ensureLocalKey,
  readIdentity,
  postToParent,
  reportTrackRef,
  identityStorageKey,
  token,
  conversation,
  messages,
  loadingOlder,
  email,
  name,
  ratingValue,
  ratingComment,
  conversationIdRef,
  preserveHistoryPosition,
  setMode,
  setConfig,
  setAvailability,
  setToken,
  setEmail,
  setName,
  setFormError,
  setSubmitting,
  setConversation,
  setMessages,
  setHasOlder,
  setLoadingOlder,
  setUnread,
  setRatingValue,
  setRatingComment,
  setRatingSubmitted,
}: {
  siteKey: string;
  embedToken: string;
  pageUrl: string;
  referrer: string;
  page: PageState;
  collectEnv: (extra?: VisitorEnv) => VisitorEnv;
  ensureLocalKey: () => string;
  readIdentity: () => StoredIdentity | null;
  postToParent: (message: Record<string, unknown>) => void;
  reportTrackRef: { current: () => Promise<void> };
  identityStorageKey: string;
  token: string | null;
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
  loadingOlder: boolean;
  email: string;
  name: string;
  ratingValue: number;
  ratingComment: string;
  conversationIdRef: { current: string | null };
  preserveHistoryPosition: () => void;
  setMode: Dispatch<SetStateAction<WidgetChatMode>>;
  setConfig: Dispatch<SetStateAction<SiteConfig | null>>;
  setAvailability: Dispatch<SetStateAction<Availability>>;
  setToken: Dispatch<SetStateAction<string | null>>;
  setEmail: Dispatch<SetStateAction<string>>;
  setName: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string | null>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  setLoadingOlder: Dispatch<SetStateAction<boolean>>;
  setUnread: Dispatch<SetStateAction<number>>;
  setRatingValue: Dispatch<SetStateAction<number>>;
  setRatingComment: Dispatch<SetStateAction<string>>;
  setRatingSubmitted: Dispatch<SetStateAction<boolean>>;
}) {
  const t = useT();
  useWidgetSessionBootstrap({
    siteKey,
    embedToken,
    identityStorageKey,
    readIdentity,
    postToParent,
    ensureLocalKey,
    reportTrackRef,
    setMode,
    setConfig,
    setAvailability,
    setToken,
    setEmail,
    setName,
    setConversation,
    setMessages,
    setHasOlder,
    setUnread,
    setRatingSubmitted,
  });

  async function startSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch("/api/widget/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-beesupport-embed": embedToken,
        },
        body: JSON.stringify({
          key: siteKey,
          localKey: ensureLocalKey(),
          email: email.trim() || undefined,
          name: name.trim() || undefined,
          env: collectEnv(),
          pageUrl: page.url || pageUrl || undefined,
          pageTitle: page.title || undefined,
          referrer: referrer || undefined,
        }),
      });
      const data = (await response.json()) as {
        token?: string;
        visitor?: { email: string; name: string | null };
        availability?: Availability;
        conversation?: VisitorConversation | null;
        messages?: SerializedMessage[];
        error?: string;
      };
      if (!response.ok || !data.token) {
        setFormError(data.error ?? t("common.operationFailed"));
        return;
      }
      window.localStorage.setItem(
        identityStorageKey,
        JSON.stringify({
          token: data.token,
          email: data.visitor?.email ?? email,
          name: data.visitor?.name ?? name,
        }),
      );
      setToken(data.token);
      if (data.availability) setAvailability(data.availability);
      setConversation(data.conversation ?? null);
      setMessages(data.messages ?? []);
      setHasOlder((data.messages?.length ?? 0) === 200);
      setMode("chat");
    } catch {
      setFormError(t("common.operationFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadOlder() {
    if (!token || !conversation || !messages[0] || loadingOlder) return;
    setLoadingOlder(true);
    const id = conversation.id;
    try {
      const state = await fetchWidgetState(token, id, messages[0].id);
      if (!state || id !== conversationIdRef.current) return;
      preserveHistoryPosition();
      setMessages((previous) => mergeMessages(previous, state.messages));
      setHasOlder(state.messages.length === 200);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function submitRating() {
    if (!token || !conversation || ratingValue === 0) return;
    const response = await fetch("/api/widget/rate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        rating: ratingValue,
        comment: ratingComment || undefined,
      }),
    });
    if (response.ok) setRatingSubmitted(true);
  }

  function startNewConversation() {
    setConversation(null);
    setMessages([]);
    setHasOlder(false);
    setRatingValue(0);
    setRatingComment("");
    setRatingSubmitted(false);
  }

  return { startSession, loadOlder, submitRating, startNewConversation };
}
