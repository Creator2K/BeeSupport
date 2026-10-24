"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import type { useT } from "@/components/locale-provider";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";

import type { WorkbenchAlert } from "./use-workbench-preferences";
import type { useWorkbenchConversationList } from "./use-workbench-conversation-list";
import type { useWorkbenchMessageThread } from "./use-workbench-message-thread";

export function useWorkbenchConversationRealtime({
  socket,
  connected,
  alertUser,
  onOpenConversation,
  list,
  thread,
  t,
}: {
  socket: Socket | null;
  connected: boolean;
  alertUser: (payload: WorkbenchAlert) => void;
  onOpenConversation: () => void;
  list: Pick<
    ReturnType<typeof useWorkbenchConversationList>,
    "upsertConversation" | "setConversations" | "refreshListRef"
  >;
  thread: Pick<
    ReturnType<typeof useWorkbenchMessageThread>,
    | "activeId"
    | "setActiveId"
    | "activeIdRef"
    | "appendMessage"
    | "markRead"
    | "loadMessages"
    | "setMessages"
  >;
  t: ReturnType<typeof useT>;
}) {
  const { upsertConversation, setConversations, refreshListRef } = list;
  const {
    activeId,
    setActiveId,
    activeIdRef,
    appendMessage,
    markRead,
    loadMessages,
    setMessages,
  } = thread;
  const [typingConversationId, setTypingConversationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!activeId) return;
    void loadMessages(activeId, true);
    void markRead(activeId);
    if (socket && connected) {
      socket.emit("conversation:join", { conversationId: activeId });
    }
    return () => {
      if (socket) {
        socket.emit("conversation:leave", { conversationId: activeId });
      }
    };
  }, [activeId, socket, connected, loadMessages, markRead]);

  useEffect(() => {
    if (!socket) return;
    const openConversation = (id: string) => {
      setActiveId(id);
      onOpenConversation();
    };

    const onMessage = (payload: {
      conversationId: string;
      message: SerializedMessage;
      conversation: SerializedConversation;
    }) => {
      upsertConversation(payload.conversation);
      const isActive = payload.conversationId === activeIdRef.current;
      if (isActive) {
        appendMessage(payload.conversationId, payload.message);
        if (
          payload.message.sender === "VISITOR" &&
          typeof document !== "undefined" &&
          document.visibilityState === "visible"
        ) {
          void markRead(payload.conversationId);
        }
      }
      if (payload.message.sender === "VISITOR") {
        const visible =
          typeof document === "undefined" ||
          document.visibilityState === "visible";
        if (!isActive || !visible) {
          alertUser({
            title: `${payload.conversation.siteName} · ${payload.conversation.visitor.name ?? payload.conversation.visitor.email}`,
            body: payload.message.body || t("common.message"),
            tag: payload.conversationId,
            onOpen: () => openConversation(payload.conversationId),
          });
        }
      }
    };

    const onConversationUpdated = (payload: {
      conversation: SerializedConversation;
    }) => {
      upsertConversation(payload.conversation);
    };
    const onConversationCreated = (payload: {
      conversation: SerializedConversation;
    }) => {
      upsertConversation(payload.conversation);
      alertUser({
        title: t("workbench.newConversation"),
        body: `${payload.conversation.siteName} · ${payload.conversation.visitor.email}`,
        tag: payload.conversation.id,
        onOpen: () => openConversation(payload.conversation.id),
      });
    };
    const onTyping = (payload: {
      conversationId: string;
      from: "VISITOR" | "AGENT";
      isTyping: boolean;
    }) => {
      if (payload.from !== "VISITOR") return;
      setTypingConversationId(payload.isTyping ? payload.conversationId : null);
    };
    const onVisitorPresence = (payload: {
      visitorId: string;
      online: boolean;
    }) => {
      setConversations((previous) =>
        previous.map((item) =>
          item.visitor.id === payload.visitorId
            ? { ...item, visitor: { ...item.visitor, online: payload.online } }
            : item,
        ),
      );
    };
    const onRead = (payload: {
      conversationId: string;
      by: "VISITOR" | "AGENT";
    }) => {
      if (payload.by !== "VISITOR") return;
      setMessages((previous) => {
        const list = previous[payload.conversationId];
        if (!list) return previous;
        const now = new Date().toISOString();
        return {
          ...previous,
          [payload.conversationId]: list.map((item) =>
            item.sender === "AGENT" && !item.readByVisitorAt
              ? { ...item, readByVisitorAt: now }
              : item,
          ),
        };
      });
    };

    socket.on("message:new", onMessage);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("conversation:created", onConversationCreated);
    socket.on("typing", onTyping);
    socket.on("presence:visitor", onVisitorPresence);
    socket.on("conversation:read", onRead);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("conversation:created", onConversationCreated);
      socket.off("typing", onTyping);
      socket.off("presence:visitor", onVisitorPresence);
      socket.off("conversation:read", onRead);
    };
  }, [
    socket,
    t,
    upsertConversation,
    appendMessage,
    markRead,
    alertUser,
    onOpenConversation,
    activeIdRef,
    setActiveId,
    setConversations,
    setMessages,
  ]);

  useEffect(() => {
    const sync = () => {
      void refreshListRef.current();
      if (activeIdRef.current) {
        void loadMessages(activeIdRef.current, true);
      }
    };
    sync();
    const timer = setInterval(sync, connected ? 60_000 : 15_000);
    return () => clearInterval(timer);
  }, [connected, loadMessages, activeIdRef, refreshListRef]);

  return { typingConversationId };
}
