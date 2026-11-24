"use client";

import type { Socket } from "socket.io-client";

import { useT } from "@/components/locale-provider";
import type { SerializedConversation } from "@/lib/realtime/types";

import { useWorkbenchConversationList } from "./use-workbench-conversation-list";
import { useWorkbenchConversationRealtime } from "./use-workbench-conversation-realtime";
import { useWorkbenchMessageThread } from "./use-workbench-message-thread";
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
  const list = useWorkbenchConversationList({
    initialConversations,
    initialConversationId,
  });
  const thread = useWorkbenchMessageThread({
    initialConversations,
    initialConversationId,
    conversations: list.conversations,
    conversationCache: list.conversationCache,
    upsertConversation: list.upsertConversation,
    setConversations: list.setConversations,
    t,
  });
  const { typingConversationId } = useWorkbenchConversationRealtime({
    socket,
    connected,
    alertUser,
    onOpenConversation,
    list,
    thread,
    t,
  });

  return {
    conversations: list.conversations,
    filters: list.filters,
    setFilters: list.setFilters,
    pageNumber: list.pageNumber,
    setPageNumber: list.setPageNumber,
    totalConversations: list.totalConversations,
    counts: list.counts,
    activeId: thread.activeId,
    setActiveId: thread.setActiveId,
    activeIdRef: thread.activeIdRef,
    messages: thread.messages,
    setMessages: thread.setMessages,
    activeMessages: thread.activeMessages,
    activeConversation: thread.activeConversation,
    loadingMessages: thread.loadingMessages,
    loadingList: list.loadingList,
    loadingOlder: thread.loadingOlder,
    hasOlderMessages: thread.hasOlderMessages,
    typingConversationId,
    refreshList: list.refreshList,
    upsertConversation: list.upsertConversation,
    appendMessage: thread.appendMessage,
    deleteMessage: thread.deleteMessage,
    loadMessages: thread.loadMessages,
    markRead: thread.markRead,
    loadOlderMessages: thread.loadOlderMessages,
    scrollRef: thread.scrollRef,
    onScroll: thread.onScroll,
    scrollToLatest: thread.scrollToLatest,
    preserveHistoryPosition: thread.preserveHistoryPosition,
    newMessagesBelow: thread.newMessagesBelow,
  };
}
