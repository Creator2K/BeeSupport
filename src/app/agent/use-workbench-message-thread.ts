"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import type { useT } from "@/components/locale-provider";
import {
  mergeMessageSnapshot,
  mergeMessages,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";

export function useWorkbenchMessageThread({
  initialConversations,
  initialConversationId,
  conversations,
  conversationCache,
  upsertConversation,
  setConversations,
  t,
}: {
  initialConversations: SerializedConversation[];
  initialConversationId: string | null;
  conversations: SerializedConversation[];
  conversationCache: Record<string, SerializedConversation>;
  upsertConversation: (
    conversation: SerializedConversation,
    refresh?: boolean,
  ) => void;
  setConversations: Dispatch<SetStateAction<SerializedConversation[]>>;
  t: ReturnType<typeof useT>;
}) {
  const [hasOlderMessages, setHasOlderMessages] = useState<
    Record<string, boolean>
  >({});
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(
    initialConversationId ?? initialConversations[0]?.id ?? null,
  );

  const [messages, setMessages] = useState<Record<string, SerializedMessage[]>>(
    {},
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const activeConversation = useMemo(
    () =>
      conversations.find((item) => item.id === activeId) ??
      (activeId ? conversationCache[activeId] : null) ??
      null,
    [conversations, activeId, conversationCache],
  );
  const activeMessages = activeId ? (messages[activeId] ?? []) : [];
  const {
    scrollRef,
    onScroll,
    scrollToLatest,
    preserveHistoryPosition,
    newMessagesBelow,
  } = useChatScroll({
    conversationId: activeId,
    messageCount: activeMessages.length,
    lastMessageId: activeMessages.at(-1)?.id,
    activity: loadingMessages,
  });

  const appendMessage = useCallback(
    (conversationId: string, message: SerializedMessage) => {
      setMessages((previous) => {
        const list = previous[conversationId] ?? [];
        if (list.some((item) => item.id === message.id)) return previous;
        const deduped = message.clientId
          ? list.filter(
              (item) =>
                !(
                  item.clientId === message.clientId &&
                  item.id.startsWith("tmp-")
                ),
            )
          : list;
        return { ...previous, [conversationId]: [...deduped, message] };
      });
    },
    [],
  );

  const loadMessages = useCallback(
    async (conversationId: string, force = false) => {
      if (!force && loadingRef.current.has(conversationId)) return;
      loadingRef.current.add(conversationId);
      setLoadingMessages(true);
      try {
        const response = await fetch(
          `/api/agent/conversations/${conversationId}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          conversation: SerializedConversation;
          messages: SerializedMessage[];
        };
        const current = messagesRef.current[conversationId] ?? [];
        setMessages((previous) => ({
          ...previous,
          [conversationId]: mergeMessageSnapshot(
            previous[conversationId] ?? [],
            data.messages,
          ),
        }));
        setHasOlderMessages((previous) => ({
          ...previous,
          [conversationId]: snapshotHasOlderMessages(
            current,
            data.messages,
            previous[conversationId],
          ),
        }));
        upsertConversation(data.conversation, false);
      } catch {
        toast.error(t("common.operationFailed"));
      } finally {
        loadingRef.current.delete(conversationId);
        setLoadingMessages(false);
      }
    },
    [upsertConversation, t],
  );

  const markRead = useCallback(async (conversationId: string) => {
    setConversations((previous) =>
      previous.map((item) =>
        item.id === conversationId ? { ...item, unreadForAgent: 0 } : item,
      ),
    );
    await fetch(`/api/agent/conversations/${conversationId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }).catch(() => undefined);
  }, [setConversations]);

  async function loadOlderMessages() {
    const id = activeId;
    const first = id ? messages[id]?.[0] : null;
    if (!id || !first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${id}?before=${encodeURIComponent(first.id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        messages: SerializedMessage[];
      };
      if (id === activeIdRef.current) preserveHistoryPosition();
      setMessages((previous) => ({
        ...previous,
        [id]: mergeMessages(previous[id] ?? [], data.messages),
      }));
      setHasOlderMessages((previous) => ({
        ...previous,
        [id]: data.messages.length === 200,
      }));
    } finally {
      setLoadingOlder(false);
    }
  }

  return {
    activeId,
    setActiveId,
    activeIdRef,
    messages,
    setMessages,
    activeMessages,
    activeConversation,
    loadingMessages,
    loadingOlder,
    hasOlderMessages,
    loadMessages,
    markRead,
    appendMessage,
    loadOlderMessages,
    scrollRef,
    onScroll,
    scrollToLatest,
    preserveHistoryPosition,
    newMessagesBelow,
  };
}
