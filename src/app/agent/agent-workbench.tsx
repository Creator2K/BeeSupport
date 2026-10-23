"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { useChatDrafts } from "@/lib/use-chat-drafts";
import { clearAccountDrafts } from "@/lib/chat-drafts";

import { useT } from "@/components/locale-provider";
import {
  ConversationList,
  type WorkbenchFilters,
} from "@/components/agent/conversation-list";
import { VisitorPanel } from "@/components/agent/visitor-panel";
import type { AgentPreferences } from "@/lib/preferences";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";
import { useSocket } from "@/lib/realtime/use-socket";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";
import {
  mergeMessageSnapshot,
  mergeMessages,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import { cn } from "@/lib/utils";
import { ConversationHeader } from "@/components/agent/conversation-header";
import type {
  WorkbenchMe,
} from "@/components/agent/workbench-types";
import { WorkbenchDialogs } from "@/components/agent/workbench-dialogs";
import { WorkbenchHeader } from "@/components/agent/workbench-header";
import { WorkbenchComposer } from "@/components/agent/workbench-composer";
import { WorkbenchMessageThread } from "@/components/agent/workbench-message-thread";
import { useWorkbenchPreferences } from "./use-workbench-preferences";
import { useWorkbenchAi } from "./use-workbench-ai";
import { useWorkbenchCanned } from "./use-workbench-canned";
import { useWorkbenchMessaging } from "./use-workbench-messaging";
import { useWorkbenchActions } from "./use-workbench-actions";

export type { WorkbenchMe } from "@/components/agent/workbench-types";

export function AgentWorkbench({
  me,
  locale,
  initialConversations,
  sites,
  initialConversationId,
  initialPreferences,
  ai,
  adminPath,
}: {
  me: WorkbenchMe;
  locale: string;
  initialConversations: SerializedConversation[];
  sites: { id: string; name: string }[];
  initialConversationId: string | null;
  /** 个人偏好（提示音音色、音量、桌面通知），存服务端 */
  initialPreferences: AgentPreferences;
  /** AI 助手可用状态与模型清单 */
  ai: { ready: boolean; models: string[]; defaultModel: string | null };
  /** 后台随机入口路径，管理员账号可以从工作台跳过去 */
  adminPath: string;
}) {
  const t = useT();
  const router = useRouter();
  const { socket, connected } = useSocket();

  const [conversations, setConversations] = useState(initialConversations);
  useEffect(() => {
    if (!socket) return;
    const reviewed = (event: { attachmentId: string; state: string }) => {
      setMessages((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, items]) => [
            id,
            items.map((message) => ({
              ...message,
              attachments: message.attachments.map((attachment) =>
                attachment.id === event.attachmentId
                  ? { ...attachment, imageReviewState: event.state }
                  : attachment,
              ),
            })),
          ]),
        ),
      );
    };
    socket.on("image:reviewed", reviewed);
    return () => {
      socket.off("image:reviewed", reviewed);
    };
  }, [socket]);

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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [drafts, setDrafts, draftsReady] = useChatDrafts(me.id);
  const draft = activeId ? (drafts[activeId] ?? "") : "";
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  function setDraft(value: string | ((previous: string) => string)) {
    if (!activeId) return;
    const id = activeId;
    setDrafts((previous) => ({
      ...previous,
      [id]: typeof value === "function" ? value(previous[id] ?? "") : value,
    }));
  }
  const [typingConversationId, setTypingConversationId] = useState<
    string | null
  >(null);
  const { prefs, updatePreferences, alertUser, toggleMute } =
    useWorkbenchPreferences(initialPreferences);
  const [mobileChatOpen, setMobileChatOpen] = useState(
    Boolean(initialConversationId),
  );

  const loadingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const {
    aiSuggestion,
    aiTrace,
    aiLoading,
    aiModelOptions,
    activeAiModel,
    generateSuggestion,
    applySuggestion,
    clearSuggestion,
  } = useWorkbenchAi({
    activeId,
    activeIdRef,
    ai,
    preferredModel: prefs.preferredModel,
  });

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

  const canned = useWorkbenchCanned({
    activeConversation,
    activeIdRef,
    draftsRef,
    onDraftChange: (conversationId, value) =>
      setDrafts((previous) => ({ ...previous, [conversationId]: value })),
    onFocus: () => composerRef.current?.focus(),
  });

  const upsertConversation = useCallback(
    (conversation: SerializedConversation, refresh = true) => {
      setConversationCache((previous) => ({
        ...previous,
        [conversation.id]: conversation,
      }));
      // One trailing refresh per burst; continuous messages cannot postpone it forever.
      if (refresh && !refreshTimerRef.current)
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          void refreshListRef.current();
        }, 1500);
      setConversations((prev) => {
        const index = prev.findIndex((item) => item.id === conversation.id);
        if (index === -1) return [conversation, ...prev];
        const next = [...prev];
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

  const {
    transferOpen,
    setTransferOpen,
    targetsLoading,
    targetsError,
    actionPending,
    targets,
    closeConfirmOpen,
    setCloseConfirmOpen,
    agentStatus,
    setAgentStatus,
    statusPending,
    runAction,
    openTransfer,
    transferTo,
    changeStatus,
  } = useWorkbenchActions({
    activeId,
    upsertConversation,
    initialStatus: me.status,
  });

  const appendMessage = useCallback(
    (conversationId: string, message: SerializedMessage) => {
      setMessages((prev) => {
        const list = prev[conversationId] ?? [];
        if (list.some((item) => item.id === message.id)) return prev;
        const deduped = message.clientId
          ? list.filter(
              (item) =>
                !(
                  item.clientId === message.clientId &&
                  item.id.startsWith("tmp-")
                ),
            )
          : list;
        return { ...prev, [conversationId]: [...deduped, message] };
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
          {
            cache: "no-store",
          },
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          conversation: SerializedConversation;
          messages: SerializedMessage[];
        };
        const current = messagesRef.current[conversationId] ?? [];
        setMessages((prev) => ({
          ...prev,
          [conversationId]: mergeMessageSnapshot(
            prev[conversationId] ?? [],
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

  const {
    sending,
    uploading,
    sendMessage,
    uploadFile,
    handlePaste,
    noteTypingActivity,
  } = useWorkbenchMessaging({
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
  });

  const markRead = useCallback(async (conversationId: string) => {
    setConversations((prev) =>
      prev.map((item) =>
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
      const data = (await response.json()) as { messages: SerializedMessage[] };
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

  // 打开会话：加入房间、拉消息、清未读
  useEffect(() => {
    if (!activeId) return;
    void loadMessages(activeId, true);
    void markRead(activeId);

    if (socket && connected) {
      socket.emit("conversation:join", { conversationId: activeId });
    }

    return () => {
      if (socket)
        socket.emit("conversation:leave", { conversationId: activeId });
    };
  }, [activeId, socket, connected, loadMessages, markRead]);

  // 实时事件
  useEffect(() => {
    if (!socket) return;

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
            onOpen: () => {
              setActiveId(payload.conversationId);
              setMobileChatOpen(true);
            },
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
        onOpen: () => {
          setActiveId(payload.conversation.id);
          setMobileChatOpen(true);
        },
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
      setConversations((prev) =>
        prev.map((item) =>
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
      setMessages((prev) => {
        const list = prev[payload.conversationId];
        if (!list) return prev;
        const now = new Date().toISOString();
        return {
          ...prev,
          [payload.conversationId]: list.map((item) =>
            item.sender === "AGENT" && !item.readByVisitorAt
              ? { ...item, readByVisitorAt: now }
              : item,
          ),
        };
      });
    };

    const onRevoked = () => {
      window.location.assign("/login");
    };
    const onAgentPresence = (payload: {
      userId: string;
      status: WorkbenchMe["status"];
    }) => {
      if (payload.userId === me.id) setAgentStatus(payload.status);
    };
    socket.on("session:revoked", onRevoked);
    socket.on("presence:agent", onAgentPresence);
    socket.on("message:new", onMessage);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("conversation:created", onConversationCreated);
    socket.on("typing", onTyping);
    socket.on("presence:visitor", onVisitorPresence);
    socket.on("conversation:read", onRead);

    return () => {
      socket.off("session:revoked", onRevoked);
      socket.off("presence:agent", onAgentPresence);
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
    setAgentStatus,
    me.id,
  ]);

  // 实时断线时轮询兜底
  useEffect(() => {
    const sync = () => {
      void refreshListRef.current();
      if (activeIdRef.current) void loadMessages(activeIdRef.current, true);
    };
    sync();
    const timer = setInterval(sync, connected ? 60_000 : 15_000);
    return () => clearInterval(timer);
  }, [connected, loadMessages]);

  function selectConversation(id: string) {
    canned.reset();
    setActiveId(id);
    setMobileChatOpen(true);
    clearSuggestion();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/agent?c=${id}`);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      clearAccountDrafts(me.id);
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error(t("common.operationFailed"));
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <WorkbenchHeader
        me={me}
        connected={connected}
        loadingList={loadingList}
        preferences={prefs}
        agentStatus={agentStatus}
        statusPending={statusPending}
        adminPath={adminPath}
        onRefresh={() => void refreshList()}
        onToggleMute={toggleMute}
        onPreferencesChange={updatePreferences}
        onChangeStatus={(status) => void changeStatus(status)}
        onLogout={() => void handleLogout()}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 shrink-0",
            mobileChatOpen ? "hidden sm:flex" : "flex",
          )}
        >
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            filters={filters}
            onFiltersChange={setFilters}
            counts={counts}
            meId={me.id}
            sites={sites}
            loading={loadingList}
            page={pageNumber}
            total={totalConversations}
            onPageChange={setPageNumber}
          />
        </div>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobileChatOpen ? "flex" : "hidden sm:flex",
          )}
        >
          {!activeConversation ? (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
              <MessagesSquare className="size-6" />
              {t("workbench.noSelection")}
            </div>
          ) : (
            <>
              <ConversationHeader
                conversation={activeConversation}
                typingConversationId={typingConversationId}
                actionPending={actionPending}
                targetsLoading={targetsLoading}
                onBack={() => setMobileChatOpen(false)}
                onClaim={() => void runAction("claim")}
                onTransfer={() => void openTransfer()}
                onReopen={() => void runAction("reopen")}
                onRequestClose={() => setCloseConfirmOpen(true)}
              />

              <WorkbenchMessageThread
                conversation={activeConversation}
                messages={activeMessages}
                loading={loadingMessages}
                hasOlder={Boolean(activeId && hasOlderMessages[activeId])}
                loadingOlder={loadingOlder}
                locale={locale}
                scrollRef={scrollRef}
                onScroll={onScroll}
                onLoadOlder={() => void loadOlderMessages()}
              />

              <WorkbenchComposer
                draft={draft}
                draftsReady={draftsReady}
                composerRef={composerRef}
                sending={sending}
                uploading={uploading}
                aiLoading={aiLoading}
                aiReady={ai.ready}
                aiModelOptions={aiModelOptions}
                activeAiModel={activeAiModel}
                aiSuggestion={aiSuggestion}
                aiTrace={aiTrace}
                newMessagesBelow={newMessagesBelow}
                cannedOpen={canned.open}
                cannedQuery={canned.query}
                cannedCategory={canned.category}
                cannedCategories={canned.categories}
                cannedLoading={canned.loading}
                cannedError={canned.error}
                cannedItems={canned.items}
                cannedInserting={canned.inserting}
                cannedHasMore={canned.hasMore}
                onDraftChange={setDraft}
                onTypingActivity={noteTypingActivity}
                onScrollToLatest={scrollToLatest}
                onUseSuggestion={() =>
                  applySuggestion((text) =>
                    setDraft((previous) =>
                      previous ? `${previous}\n${text}` : text,
                    ),
                  )
                }
                onDismissSuggestion={clearSuggestion}
                onModelChange={(value) =>
                  updatePreferences({ preferredModel: value })
                }
                onGenerateSuggestion={() => void generateSuggestion()}
                onCannedOpenChange={canned.setOpen}
                onCannedQueryChange={canned.setQuery}
                onCannedCategoryChange={canned.setCategory}
                onInsertCanned={canned.insert}
                onUploadFile={uploadFile}
                onSend={() => void sendMessage()}
                onPaste={(event) => void handlePaste(event)}
              />
            </>
          )}
        </main>

        {activeConversation ? (
          <VisitorPanel
            key={activeConversation.id}
            conversation={activeConversation}
            onUpdated={upsertConversation}
            onOpenConversation={selectConversation}
            profileHref={
              me.role !== "AGENT"
                ? `${adminPath}/visitors/${activeConversation.visitor.id}`
                : undefined
            }
          />
        ) : null}
      </div>

      <WorkbenchDialogs
        transferOpen={transferOpen}
        onTransferOpenChange={setTransferOpen}
        targetsLoading={targetsLoading}
        targetsError={targetsError}
        targets={targets}
        actionPending={actionPending}
        onRetryTargets={() => void openTransfer()}
        onTransfer={(targetId) => void transferTo(targetId)}
        closeConfirmOpen={closeConfirmOpen}
        onCloseConfirmOpenChange={setCloseConfirmOpen}
        onConfirmClose={() => {
          void runAction("close").then((ok) => {
            if (ok) setCloseConfirmOpen(false);
          });
        }}
      />
    </div>
  );
}
