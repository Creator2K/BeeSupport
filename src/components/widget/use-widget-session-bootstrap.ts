"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

import type {
  Availability,
  SiteConfig,
} from "@/components/widget/widget-types";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

import type { StoredIdentity } from "./use-widget-tracking";
import { fetchWidgetState } from "./widget-session-api";
import type { WidgetChatMode } from "./use-widget-session-state";

export function useWidgetSessionBootstrap({
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
}: {
  siteKey: string;
  embedToken: string;
  identityStorageKey: string;
  readIdentity: () => StoredIdentity | null;
  postToParent: (message: Record<string, unknown>) => void;
  ensureLocalKey: () => string;
  reportTrackRef: { current: () => Promise<void> };
  setMode: Dispatch<SetStateAction<WidgetChatMode>>;
  setConfig: Dispatch<SetStateAction<SiteConfig | null>>;
  setAvailability: Dispatch<SetStateAction<Availability>>;
  setToken: Dispatch<SetStateAction<string | null>>;
  setEmail: Dispatch<SetStateAction<string>>;
  setName: Dispatch<SetStateAction<string>>;
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  setUnread: Dispatch<SetStateAction<number>>;
  setRatingSubmitted: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!siteKey) {
        setMode("error");
        return;
      }
      try {
        const response = await fetch(
          `/api/widget/config?key=${encodeURIComponent(siteKey)}`,
          { cache: "no-store", headers: { "x-beesupport-embed": embedToken } },
        );
        if (!response.ok) {
          if (!cancelled) setMode("error");
          return;
        }
        const data = (await response.json()) as {
          site: SiteConfig;
          availability: Availability;
        };
        if (cancelled) return;
        setConfig(data.site);
        setAvailability(data.availability);
        ensureLocalKey();
        void reportTrackRef.current();
        postToParent({ type: "beesupport:ready", site: data.site });

        const stored = readIdentity();
        if (stored?.token) {
          const state = await fetchWidgetState(stored.token);
          if (cancelled) return;
          if (state) {
            setToken(stored.token);
            setEmail(stored.email ?? "");
            setName(stored.name ?? "");
            setConversation(state.conversation);
            setMessages(state.messages);
            setHasOlder(state.messages.length === 200);
            setUnread(state.conversation?.unreadForVisitor ?? 0);
            if (state.conversation?.rating) setRatingSubmitted(true);
            setMode("chat");
            return;
          }
          window.localStorage.removeItem(identityStorageKey);
        }

        if (stored?.email) setEmail(stored.email);
        if (stored?.name) setName(stored.name);
        setMode("form");
      } catch {
        if (!cancelled) setMode("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    siteKey,
    identityStorageKey,
    readIdentity,
    postToParent,
    embedToken,
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
  ]);
}
