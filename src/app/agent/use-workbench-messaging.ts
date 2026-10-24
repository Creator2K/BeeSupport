"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import type { SerializedMessage } from "@/lib/realtime/types";
import {
  prepareSendAttempt,
  type SendAttempt,
} from "@/lib/realtime/send-attempt";

import { extractClipboardFiles } from "@/lib/clipboard-files";

type DraftUpdater = (value: string | ((previous: string) => string)) => void;

export function useWorkbenchMessaging({
  activeId,
  activeIdRef,
  activeConversation,
  me,
  draft,
  setDraft,
  setMessages,
  appendMessage,
  loadMessages,
  scrollToLatest,
  socket,
}: {
  activeId: string | null;
  activeIdRef: { current: string | null };
  activeConversation: { id: string; siteId: string } | null;
  me: { id: string; name: string };
  draft: string;
  setDraft: DraftUpdater;
  setMessages: Dispatch<
    SetStateAction<Record<string, SerializedMessage[]>>
  >;
  appendMessage: (conversationId: string, message: SerializedMessage) => void;
  loadMessages: (conversationId: string, force?: boolean) => Promise<void>;
  scrollToLatest: () => void;
  socket: Socket | null;
}) {
  const t = useT();
  const sendAttemptsRef = useRef(new Map<string, SendAttempt>());
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const typingSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
      }
    };
  }, []);

  function emitTyping(isTyping: boolean) {
    if (!socket || !activeId) return;
    const now = Date.now();
    if (isTyping && now - typingSentAtRef.current < 2000) return;
    typingSentAtRef.current = now;
    socket.emit("typing", { conversationId: activeId, isTyping });
  }

  function noteTypingActivity() {
    emitTyping(true);
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }
    typingStopTimerRef.current = setTimeout(() => emitTyping(false), 2500);
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !activeId || sendingRef.current) return;

    const attempt = prepareSendAttempt(
      sendAttemptsRef.current.get(activeId) ?? null,
      activeId,
      body,
    );
    sendAttemptsRef.current.set(activeId, attempt);
    const { clientId } = attempt;
    sendingRef.current = true;

    const optimistic: SerializedMessage = {
      id: `tmp-${clientId}`,
      conversationId: activeId,
      sender: "AGENT",
      type: "TEXT",
      body,
      authorId: me.id,
      authorName: me.name,
      createdAt: new Date().toISOString(),
      readByAgentAt: new Date().toISOString(),
      readByVisitorAt: null,
      clientId,
      attachments: [],
      meta: null,
    };

    scrollToLatest();
    appendMessage(activeId, optimistic);
    setDraft("");
    setSending(true);
    emitTyping(false);

    try {
      const response = await fetch(
        `/api/agent/conversations/${activeId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, clientId }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(data.error ?? t("common.operationFailed"));
        setMessages((previous) => ({
          ...previous,
          [activeId]: (previous[activeId] ?? []).filter(
            (item) => item.id !== `tmp-${clientId}`,
          ),
        }));
        setDraft((current) => current || body);
      } else {
        sendAttemptsRef.current.delete(activeId);
        window.dispatchEvent(new Event("beesupport:followups-changed"));
        await loadMessages(activeId, true);
      }
    } catch {
      toast.error(t("common.operationFailed"));
      setMessages((previous) => ({
        ...previous,
        [activeId]: (previous[activeId] ?? []).filter(
          (message) => message.id !== `tmp-${clientId}`,
        ),
      }));
      setDraft((current) => current || body);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function uploadFile(file: File): Promise<boolean> {
    if (!activeId || !activeConversation) return false;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("siteId", activeConversation.siteId);
      formData.set("conversationId", activeId);

      const upload = await fetch("/api/agent/upload", {
        method: "POST",
        body: formData,
      });
      if (!upload.ok) {
        const data = (await upload.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(data.error ?? t("widget.uploadFailed"));
        return false;
      }
      const uploaded = (await upload.json()) as {
        attachment: { id: string };
      };

      const response = await fetch(
        `/api/agent/conversations/${activeId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: "",
            attachmentIds: [uploaded.attachment.id],
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(data.error ?? t("widget.sendFailed"));
      } else {
        if (activeIdRef.current === activeId) scrollToLatest();
        window.dispatchEvent(new Event("beesupport:followups-changed"));
        await loadMessages(activeId, true);
        return true;
      }
    } catch {
      toast.error(t("widget.uploadFailed"));
    } finally {
      setUploading(false);
    }
    return false;
  }

  async function handlePaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    const files = extractClipboardFiles(event.clipboardData?.items);
    if (files.length === 0) return;

    event.preventDefault();
    let allSucceeded = true;
    for (const file of files.slice(0, 4)) {
      allSucceeded = (await uploadFile(file)) && allSucceeded;
    }
    if (allSucceeded) toast.success(t("widget.imageAttached"));
  }

  return {
    sending,
    uploading,
    sendMessage,
    uploadFile,
    handlePaste,
    noteTypingActivity,
  };
}