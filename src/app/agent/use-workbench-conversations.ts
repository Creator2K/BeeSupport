"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import type { WorkbenchFilters } from "@/components/agent/conversation-list";
import { useT } from "@/components/locale-provider";
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

import type { WorkbenchAlert } from "./use-workbench-preferences";

export function useWorkbenchConversations({
  initialConversations,
  initialConversationId,
  socket,
  connected,
  alertUser,
  onOpenConversation,
}: {
  initialConversations: SerializedConversation[];
  initialConversationId: string | null;
  socket: Socket | null;
  connected: boolean;
  alertUser: (payload: WorkbenchAlert) => void;
  onOpenConversation: () => void;
}) {
  const t = useT();
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationCache, setConversationCache] = useState<
    Record<string, SerializedConversation>
  >({});
  const [pageNumber, setPageNumber] = useState(1);
  const [totalConversations, setTotalConversations] = useState(0);
  const [counts, setCounts] = useState({
    pending: 0,
    open: 0,
    unread: 0,
    mine: 0,
  });
  const [hasOlderMessages, setHasOlderMessages] = useState<
    Record<string, boolean>
  >({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRequestRef = useRef(0);
  const refreshListRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filters, setFilters] = useState<WorkbenchFilters>({
    tab: initialConversationId ? "all" : "queue",
    siteId: "all",
    query: "",
    unreadOnly: false,
  });
  const [activeId, setActiveId] = useState<string | null>(
    initialConversationId ?? initialConversations[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<Record<string, SerializedMessage[]>>(
    {},
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [typingConversationId, setTypingConversationId] = useState<
    string | null
  >(null);
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

  const upsertConversation = useCallback(
    (conversation: SerializedConversation, refresh = true) => {
      setConversationCache((previous) => ({
        ...previous,
        [conversation.id]: conversation,
      }));
      if (refresh && !refreshTimerRef.current) {
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          void refreshListRef.current();
        }, 1500);
      }
      setConversations((previous) => {
        const index = previous.findIndex(
          (item) => item.id === conversation.id,
        );
        if (index === -1) return [conversation, ...previous];
        const next = [...previous];
        next[index] = conversation;
        return next.sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime(),
        );
      });
    },
    [],
  );

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
  }, []);

  const refreshList = useCallback(async () => {
    const sequence = ++listRequestRef.current;
    setLoadingList(true);
    const query = new URLSearchParams({
      pageSize: "50",
      page: String(pageNumber),
    });
    if (filters.tab === "queue") query.set("status", "PENDING");
    else if (filters.tab === "closed") query.set("status", "CLOSED");
    else query.set("active", "1");
    if (filters.tab === "mine") query.set("assignedTo", "me");
    if (filters.siteId !== "all") query.set("siteId", filters.siteId);
    if (filters.query.trim()) query.set("query", filters.query.trim());
    if (filters.unreadOnly) query.set("unread", "1");
    try {
      const response = await fetch(`/api/agent/conversations?${query}`, {
        cache: "no-store",
      });
      if (!response.ok || sequence !== listRequestRef.current) return;
      const data = (await response.json()) as {
        items: SerializedConversation[];
        total: number;
        counts: typeof counts;
      };
      if (sequence !== listRequestRef.current) return;
      setConversations(data.items);
      setTotalConversations(data.total);
      const lastPage = Math.max(1, Math.ceil(data.total / 50));
      if (pageNumber > lastPage) setPageNumber(lastPage);
      setCounts(data.counts);
      setConversationCache((previous) => ({
        ...previous,
        ...Object.fromEntries(data.items.map((item) => [item.id, item])),
      }));
    } catch {
      /* A subsequent reconnect or poll retries the list. */
    } finally {
      if (sequence === listRequestRef.current) setLoadingList(false);
    }
  }, [filters, pageNumber]);
  refreshListRef.current = refreshList;

  useEffect(() => {
    setPageNumber(1);
  }, [filters]);
  useEffect(() => {
    const timer = setTimeout(() => void refreshList(), 200);
    return () => {
      clearTimeout(timer);
      listRequestRef.current += 1;
    };
  }, [refreshList]);
  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

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
  }, [connected, loadMessages]);

  return {
    conversations,
    filters,
    setFilters,
    pageNumber,
    setPageNumber,
    totalConversations,
    counts,
    activeId,
    setActiveId,
    activeIdRef,
    messages,
    setMessages,
    activeMessages,
    activeConversation,
    loadingMessages,
    loadingList,
    loadingOlder,
    hasOlderMessages,
    typingConversationId,
    refreshList,
    upsertConversation,
    appendMessage,
    loadMessages,
    markRead,
    loadOlderMessages,
    scrollRef,
    onScroll,
    scrollToLatest,
    preserveHistoryPosition,
    newMessagesBelow,
  };
}