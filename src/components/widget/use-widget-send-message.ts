"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { useT } from "@/components/locale-provider";
import type { Availability } from "@/components/widget/widget-types";
import {
  mergeMessageSnapshot,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";
import {
  prepareSendAttempt,
  type SendAttempt,
} from "@/lib/realtime/send-attempt";

export function useWidgetSendMessage({
  token,
  availability,
  conversation,
  draft,
  messagesRef,
  setConversation,
  setMessages,
  setDraft,
  setHasOlder,
  scrollToLatest,
  t,
}: {
  token: string | null;
  availability: Availability;
  conversation: VisitorConversation | null;
  draft: string;
  messagesRef: { current: SerializedMessage[] };
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  scrollToLatest: () => void;
  t: ReturnType<typeof useT>;
}) {
  const [sending, setSending] = useState(false);
  const sendAttemptRef = useRef<SendAttempt | null>(null);
  const sendingRef = useRef(false);

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sendingRef.current || !token) return;

    const attempt = prepareSendAttempt(sendAttemptRef.current, token, body);
    sendAttemptRef.current = attempt;
    const { clientId } = attempt;
    sendingRef.current = true;

    const optimistic: SerializedMessage = {
      id: `tmp-${clientId}`,
      conversationId: conversation?.id ?? "pending",
      sender: "VISITOR",
      type: "TEXT",
      body,
      authorId: null,
      authorName: null,
      createdAt: new Date().toISOString(),
      readByAgentAt: null,
      readByVisitorAt: new Date().toISOString(),
      clientId,
      attachments: [],
      meta: null,
    };

    scrollToLatest();
    setMessages((previous) => [...previous, optimistic]);
    setDraft("");
    setSending(true);

    try {
      const response = await fetch("/api/widget/conversation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          conversation
            ? { conversationId: conversation.id, body, clientId }
            : {
                body,
                clientId,
                source: availability.online ? "WIDGET" : "OFFLINE_FORM",
              },
        ),
      });
      const data = (await response.json()) as {
        conversation?: VisitorConversation | null;
        messages?: SerializedMessage[];
        error?: string;
      };
      if (!response.ok) {
        setMessages((previous) =>
          previous.filter((item) => item.id !== `tmp-${clientId}`),
        );
        setDraft((current) => current || body);
        toast.error(data.error ?? t("widget.sendFailed"));
        return;
      }

      sendAttemptRef.current = null;
      setConversation(data.conversation ?? null);
      const current = messagesRef.current;
      setMessages((previous) =>
        mergeMessageSnapshot(
          previous.filter(
            (item) => item.clientId !== clientId || !item.id.startsWith("tmp-"),
          ),
          data.messages ?? [],
        ),
      );
      setHasOlder((previous) =>
        snapshotHasOlderMessages(current, data.messages ?? [], previous),
      );
    } catch {
      setMessages((previous) =>
        previous.filter((item) => item.id !== `tmp-${clientId}`),
      );
      setDraft((current) => current || body);
      toast.error(t("widget.sendFailed"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return { sending, sendMessage };
}
