"use client";

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Socket } from "socket.io-client";

import type { Availability } from "@/components/widget/widget-types";
import {
  mergeMessageSnapshot,
  mergeMessages,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";
import type { ImageGate } from "@/server/services/image-review";

type FetchState = (
  visitorToken: string,
  conversationId?: string | null,
  before?: string,
) => Promise<{
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
} | null>;

export function useWidgetRealtime({
  socket,
  connected,
  token,
  parentOpened,
  conversationIdRef,
  messagesRef,
  reportTrackRef,
  fetchState,
  markRead,
  setConversation,
  setMessages,
  setUnread,
  setAgentTyping,
  setImageGate,
  setHasOlder,
  setAvailability,
  setRatingSubmitted,
}: {
  socket: Socket | null;
  connected: boolean;
  token: string | null;
  parentOpened: boolean;
  conversationIdRef: { current: string | null };
  messagesRef: { current: SerializedMessage[] };
  reportTrackRef: { current: () => Promise<void> };
  fetchState: FetchState;
  markRead: (conversationId: string) => void;
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setUnread: Dispatch<SetStateAction<number>>;
  setAgentTyping: Dispatch<SetStateAction<boolean>>;
  setImageGate: Dispatch<SetStateAction<ImageGate>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  setAvailability: Dispatch<SetStateAction<Availability>>;
  setRatingSubmitted: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!socket) return;
    const updateGate = (gate: ImageGate) => setImageGate(gate);
    socket.on("image:gate", updateGate);
    return () => {
      socket.off("image:gate", updateGate);
    };
  }, [socket, setImageGate]);
  useEffect(() => {
    if (!socket) return;

    const onMessage = (payload: {
      conversationId: string;
      message: SerializedMessage;
      conversation: VisitorConversation;
    }) => {
      if (
        conversationIdRef.current &&
        payload.conversationId !== conversationIdRef.current
      ) {
        if (
          payload.message.sender === "AGENT" ||
          payload.message.sender === "AI"
        ) {
          setUnread((value) => value + 1);
        }
        return;
      }

      setConversation(payload.conversation);
      setMessages((previous) => mergeMessages(previous, [payload.message]));
      setImageGate((previous) =>
        previous.pending &&
        payload.message.attachments.some(
          (attachment) => attachment.id === previous.pending!.id,
        )
          ? {
              ...previous,
              pending: {
                ...previous.pending,
                sent: true,
                conversationId: payload.conversationId,
              },
            }
          : previous,
      );

      if (
        payload.message.sender === "AGENT" ||
        payload.message.sender === "AI"
      ) {
        setAgentTyping(false);
        const hidden =
          typeof document !== "undefined" &&
          document.visibilityState !== "visible";
        if (hidden || !parentOpened) {
          setUnread((value) => value + 1);
        } else {
          markRead(payload.conversationId);
        }
      }
    };

    const onConversationUpdated = (payload: {
      conversation: VisitorConversation;
    }) => {
      if (
        payload.conversation.id === conversationIdRef.current ||
        !conversationIdRef.current
      ) {
        setConversation(payload.conversation);
        if (payload.conversation.rating) setRatingSubmitted(true);
      }
    };

    const onTyping = (payload: {
      conversationId: string;
      from: "VISITOR" | "AGENT";
      isTyping: boolean;
    }) => {
      if (payload.from !== "AGENT") return;
      if (payload.conversationId !== conversationIdRef.current) return;
      setAgentTyping(payload.isTyping);
    };

    const onRead = (payload: { conversationId: string; by: string }) => {
      if (
        payload.by === "AGENT" &&
        payload.conversationId === conversationIdRef.current
      ) {
        setMessages((previous) =>
          previous.map((message) =>
            message.sender === "VISITOR" && !message.readByAgentAt
              ? { ...message, readByAgentAt: new Date().toISOString() }
              : message,
          ),
        );
      }
    };

    socket.on("conversation:read", onRead);
    socket.on("conversation:created", onConversationUpdated);
    socket.on("message:new", onMessage);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("typing", onTyping);
    return () => {
      socket.off("conversation:read", onRead);
      socket.off("conversation:created", onConversationUpdated);
      socket.off("message:new", onMessage);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("typing", onTyping);
    };
  }, [
    socket,
    parentOpened,
    markRead,
    setImageGate,
    setConversation,
    setMessages,
    setUnread,
    setAgentTyping,
    setRatingSubmitted,
    conversationIdRef,
  ]);
  useEffect(() => {
    const conversationId = conversationIdRef.current;
    if (!socket || !connected || !conversationId) return;
    socket.emit("conversation:join", { conversationId });
    return () => {
      socket.emit("conversation:leave", { conversationId });
    };
  }, [socket, connected, conversationIdRef]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const sync = async () => {
      const currentId = conversationIdRef.current;
      const state = await fetchState(token, currentId);
      if (cancelled || currentId !== conversationIdRef.current || !state) {
        return;
      }
      setConversation(state.conversation);
      const current = messagesRef.current;
      setMessages((previous) =>
        mergeMessageSnapshot(previous, state.messages),
      );
      setHasOlder((previous) =>
        snapshotHasOlderMessages(current, state.messages, previous),
      );
      if (!parentOpened) {
        setUnread(state.conversation?.unreadForVisitor ?? 0);
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    token,
    connected,
    parentOpened,
    fetchState,
    conversationIdRef,
    messagesRef,
    setConversation,
    setMessages,
    setHasOlder,
    setUnread,
  ]);

  useEffect(() => {
    if (!token) return;
    const pingSocket = () => socket?.emit("visitor:ping");
    const pingRest = async () => {
      try {
        const response = await fetch("/api/widget/ping", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = (await response.json()) as { availability: Availability };
        setAvailability(data.availability);
      } catch {
        /* Ignore transient network failures. */
      }
    };

    void reportTrackRef.current().then(() => pingRest());
    const socketTimer = setInterval(pingSocket, 30_000);
    const restTimer = setInterval(() => void pingRest(), 60_000);
    return () => {
      clearInterval(socketTimer);
      clearInterval(restTimer);
    };
  }, [token, socket, reportTrackRef, setAvailability]);
}
