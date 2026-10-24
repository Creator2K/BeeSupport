"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkbenchFilters } from "@/components/agent/conversation-list";
import type { SerializedConversation } from "@/lib/realtime/types";

export function useWorkbenchConversationList({
  initialConversations,
  initialConversationId,
}: {
  initialConversations: SerializedConversation[];
  initialConversationId: string | null;
}) {
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

  const listRequestRef = useRef(0);
  const refreshListRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filters, setFilters] = useState<WorkbenchFilters>({
    tab: initialConversationId ? "all" : "queue",
    siteId: "all",
    query: "",
    unreadOnly: false,
  });

  const [loadingList, setLoadingList] = useState(false);

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

  return {
    conversations,
    setConversations,
    conversationCache,
    setConversationCache,
    pageNumber,
    setPageNumber,
    totalConversations,
    counts,
    filters,
    setFilters,
    loadingList,
    refreshList,
    refreshListRef,
    upsertConversation,
  };
}
