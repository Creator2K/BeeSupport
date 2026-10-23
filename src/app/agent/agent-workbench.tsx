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
import {
  bindAudioUnlock,
  playSound,
  showDesktopNotification,
  unlockAudio,
} from "@/lib/notify";
import {
  parsePreferences,
  type AgentPreferences,
  type SoundPresetId,
} from "@/lib/preferences";
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
import {
  prepareSendAttempt,
  type SendAttempt,
} from "@/lib/realtime/send-attempt";
import { listTransferTargetsAction } from "@/server/actions/agents";
import { savePreferencesAction } from "@/server/actions/preferences";
import { cn } from "@/lib/utils";
import { appendCannedText } from "@/lib/canned";
import { ConversationHeader } from "@/components/agent/conversation-header";
import type {
  AiSuggestionTrace,
  CannedItem,
  TransferTarget,
  WorkbenchMe,
} from "@/components/agent/workbench-types";
import { WorkbenchDialogs } from "@/components/agent/workbench-dialogs";
import { WorkbenchHeader } from "@/components/agent/workbench-header";
import { WorkbenchComposer } from "@/components/agent/workbench-composer";
import { WorkbenchMessageThread } from "@/components/agent/workbench-message-thread";

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
  const sendAttemptsRef = useRef(new Map<string, SendAttempt>());
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typingConversationId, setTypingConversationId] = useState<
    string | null
  >(null);
  const [agentStatus, setAgentStatus] = useState(me.status);
  const [statusPending, setStatusPending] = useState(false);
  const [prefs, setPrefs] = useState<AgentPreferences>(() =>
    parsePreferences(initialPreferences),
  );
  const [cannedResult, setCannedResult] = useState<{
    key: string;
    siteId: string;
    items: CannedItem[];
    categories: string[];
    hasMore: boolean;
    error: boolean;
  }>({
    key: "",
    siteId: "",
    items: [],
    categories: [],
    hasMore: false,
    error: false,
  });
  const [cannedCategory, setCannedCategory] = useState("");
  const [cannedInserting, setCannedInserting] = useState(false);
  const cannedInsertRef = useRef(false);
  const [cannedQuery, setCannedQuery] = useState("");
  const [cannedOpen, setCannedOpen] = useState(false);
  function changeCannedOpen(open: boolean) {
    if (open) setCannedResult((previous) => ({ ...previous, key: "" }));
    setCannedOpen(open);
  }
  const [transferOpen, setTransferOpen] = useState(false);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const actionPendingRef = useRef(false);
  const [targets, setTargets] = useState<TransferTarget[]>([]);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(
    Boolean(initialConversationId),
  );
  const [suggestion, setSuggestion] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const aiSuggestion =
    suggestion?.conversationId === activeId ? suggestion.text : null;
  const aiRequestRef = useRef<AbortController | null>(null);
  const [aiTrace, setAiTrace] = useState<AiSuggestionTrace | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const prefsRef = useRef<AgentPreferences>(initialPreferences);
  prefsRef.current = prefs;
  const typingSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    setSuggestion(null);
    setAiTrace(null);
    setAiLoading(false);
    return () => {
      aiRequestRef.current?.abort();
      aiRequestRef.current = null;
    };
  }, [activeId]);

  // 浏览器要求先有一次用户手势才允许出声，这里挂一次性解锁监听
  useEffect(() => bindAudioUnlock(), []);

  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferenceVersion = useRef(0);
  const confirmedPreferences = useRef(parsePreferences(initialPreferences));
  const updatePreferences = useCallback(
    (patch: Partial<AgentPreferences>) => {
      const version = ++preferenceVersion.current;
      setPrefs((prev) => parsePreferences({ ...prev, ...patch }));
      preferenceQueue.current = preferenceQueue.current.then(async () => {
        try {
          const result = await savePreferencesAction(patch);
          if (!result.ok) throw new Error(result.error);
          confirmedPreferences.current = result.preferences;
          if (version === preferenceVersion.current)
            setPrefs(result.preferences);
        } catch {
          toast.error(t("common.operationFailed"));
          if (version === preferenceVersion.current)
            setPrefs(confirmedPreferences.current);
        }
      });
    },
    [t],
  );

  // Migrate the old local mute setting through the same error-aware save queue.
  useEffect(() => {
    const legacy = window.localStorage.getItem("beesupport:sound");
    if (legacy) window.localStorage.removeItem("beesupport:sound");
    if (legacy === "off") {
      updatePreferences({ soundPreset: "none" });
    }
  }, [updatePreferences]);

  /** 通知：按偏好播放提示音 + 桌面通知 */
  const alertUser = useCallback(
    (payload: {
      title: string;
      body: string;
      tag: string;
      onOpen?: () => void;
    }) => {
      const current = prefsRef.current;
      playSound(current.soundPreset, current.soundVolume);
      if (current.desktopNotify) {
        showDesktopNotification({
          title: payload.title,
          body: payload.body,
          tag: payload.tag,
          onClick: payload.onOpen,
        });
      }
    },
    [],
  );

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

  // Refresh the current site's permitted replies on open, search and category changes.
  const cannedSiteId = activeConversation?.siteId ?? "";
  const cannedKey = JSON.stringify([cannedSiteId, cannedQuery, cannedCategory]);
  useEffect(() => {
    if (!cannedOpen || !cannedSiteId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            siteId: cannedSiteId,
            query: cannedQuery,
            category: cannedCategory,
          });
          const response = await fetch(`/api/agent/canned?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Unable to load replies");
          const data = (await response.json()) as {
            items: CannedItem[];
            categories: string[];
            hasMore: boolean;
          };
          if (!controller.signal.aborted)
            setCannedResult({
              ...data,
              key: cannedKey,
              siteId: cannedSiteId,
              error: false,
            });
        } catch {
          if (!controller.signal.aborted)
            setCannedResult({
              key: cannedKey,
              siteId: cannedSiteId,
              items: [],
              categories: [],
              hasMore: false,
              error: true,
            });
        }
      })();
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cannedOpen, cannedSiteId, cannedQuery, cannedCategory, cannedKey]);

  function selectConversation(id: string) {
    setCannedOpen(false);
    setCannedQuery("");
    setCannedCategory("");
    setActiveId(id);
    setMobileChatOpen(true);
    setSuggestion(null);
    setAiTrace(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/agent?c=${id}`);
    }
  }

  const aiModelOptions = useMemo(() => {
    const list = [...ai.models];
    const preferred = prefs.preferredModel;
    if (preferred && !list.includes(preferred)) list.unshift(preferred);
    return list;
  }, [ai.models, prefs.preferredModel]);

  const activeAiModel =
    prefs.preferredModel && aiModelOptions.includes(prefs.preferredModel)
      ? prefs.preferredModel
      : (ai.defaultModel ?? aiModelOptions[0] ?? "");

  async function generateSuggestion() {
    if (!activeId || aiRequestRef.current) return;
    const conversationId = activeId;
    const controller = new AbortController();
    aiRequestRef.current = controller;
    setAiLoading(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${activeId}/suggest`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: activeAiModel || undefined }),
          signal: controller.signal,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        model?: string;
        trace?: { name: string; summary: string; ok: boolean; ms: number }[];
        knowledge?: { title: string; score: number; via: string }[];
        error?: string;
      };
      if (controller.signal.aborted || activeIdRef.current !== conversationId)
        return;
      if (!response.ok || !data.text) {
        toast.error(data.error ?? t("workbench.aiFailed"));
        return;
      }
      setSuggestion({ conversationId, text: data.text });
      setAiTrace({
        model: data.model ?? activeAiModel,
        tools: data.trace ?? [],
        knowledge: data.knowledge ?? [],
      });
    } catch {
      if (!controller.signal.aborted && activeIdRef.current === conversationId)
        toast.error(t("workbench.aiFailed"));
    } finally {
      if (aiRequestRef.current === controller) {
        aiRequestRef.current = null;
        setAiLoading(false);
      }
    }
  }

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
        setMessages((prev) => ({
          ...prev,
          [activeId]: (prev[activeId] ?? []).filter(
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

  /** 从剪贴板里挑出文件（截图粘贴会以 file 形式出现） */
  function extractFiles(list: DataTransferItemList | null | undefined): File[] {
    if (!list) return [];
    const files: File[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (item && item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  async function handlePaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    const files = extractFiles(event.clipboardData?.items);
    if (files.length === 0) return;

    event.preventDefault();
    let allSucceeded = true;
    for (const file of files.slice(0, 4)) {
      allSucceeded = (await uploadFile(file)) && allSucceeded;
    }
    if (allSucceeded) toast.success(t("widget.imageAttached"));
  }

  async function runAction(
    action: "claim" | "close" | "reopen" | "transfer",
    targetAgentId?: string,
  ): Promise<boolean> {
    if (!activeId || actionPendingRef.current) return false;
    actionPendingRef.current = true;
    setActionPending(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${activeId}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, targetAgentId }),
        },
      );
      const data = (await response.json()) as {
        conversation?: SerializedConversation;
        error?: string;
      };
      if (!response.ok) {
        toast.error(data.error ?? t("common.operationFailed"));
        return false;
      }
      if (data.conversation) upsertConversation(data.conversation);
      window.dispatchEvent(new Event("beesupport:followups-changed"));
      toast.success(
        action === "claim"
          ? t("workbench.claimed")
          : action === "close"
            ? t("conversations.statusClosed")
            : action === "transfer"
              ? t("workbench.transferDone")
              : t("workbench.reopen"),
      );
      return true;
    } catch {
      toast.error(t("common.operationFailed"));
      return false;
    } finally {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }

  async function openTransfer() {
    setTransferOpen(true);
    setTargets([]);
    setTargetsError(false);
    setTargetsLoading(true);
    try {
      setTargets(await listTransferTargetsAction());
    } catch {
      setTargetsError(true);
      toast.error(t("common.operationFailed"));
    } finally {
      setTargetsLoading(false);
    }
  }

  async function transferTo(agentId: string) {
    if (await runAction("transfer", agentId)) setTransferOpen(false);
  }

  async function insertCanned(item: CannedItem) {
    if (!activeConversation || cannedInsertRef.current) return;
    const conversationId = activeConversation.id;
    const siteId = activeConversation.siteId;
    cannedInsertRef.current = true;
    setCannedInserting(true);
    try {
      appendCannedText(draftsRef.current[conversationId] ?? "", item.content);
      const response = await fetch("/api/agent/canned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, siteId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || t("common.operationFailed"));
      const next = appendCannedText(
        draftsRef.current[conversationId] ?? "",
        result.item.content,
      );
      setDrafts((previous) => ({ ...previous, [conversationId]: next }));
      if (activeIdRef.current === conversationId) {
        setCannedOpen(false);
        setCannedQuery("");
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("common.operationFailed"),
      );
    } finally {
      cannedInsertRef.current = false;
      setCannedInserting(false);
    }
  }

  async function changeStatus(status: "ONLINE" | "AWAY" | "OFFLINE") {
    if (statusPending) return;
    setStatusPending(true);
    try {
      const response = await fetch("/api/agent/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Status update failed");
      setAgentStatus(status);
      toast.success(
        status === "ONLINE"
          ? t("workbench.statusOnline")
          : status === "AWAY"
            ? t("workbench.statusAway")
            : t("workbench.statusOffline"),
      );
    } catch {
      toast.error(t("common.operationFailed"));
    } finally {
      setStatusPending(false);
    }
  }

  function toggleMute() {
    const next: SoundPresetId = prefs.soundPreset === "none" ? "chime" : "none";
    // 这次点击本身就是用户手势，先解锁音频再试听
    unlockAudio();
    updatePreferences({ soundPreset: next });
    if (next !== "none") playSound(next, prefs.soundVolume);
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

  const cannedLoading = cannedOpen && cannedResult.key !== cannedKey;
  const filteredCanned =
    cannedResult.key === cannedKey ? cannedResult.items : [];
  const cannedCategories =
    cannedResult.siteId === cannedSiteId ? cannedResult.categories : [];

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
                cannedOpen={cannedOpen}
                cannedQuery={cannedQuery}
                cannedCategory={cannedCategory}
                cannedCategories={cannedCategories}
                cannedLoading={cannedLoading}
                cannedError={Boolean(cannedResult.error)}
                cannedItems={filteredCanned}
                cannedInserting={cannedInserting}
                cannedHasMore={cannedResult.hasMore}
                onDraftChange={setDraft}
                onTypingActivity={noteTypingActivity}
                onScrollToLatest={scrollToLatest}
                onUseSuggestion={() => {
                  setDraft((previous) =>
                    previous ? `${previous}\n${aiSuggestion ?? ""}` : (aiSuggestion ?? ""),
                  );
                  setSuggestion(null);
                  setAiTrace(null);
                }}
                onDismissSuggestion={() => {
                  setSuggestion(null);
                  setAiTrace(null);
                }}
                onModelChange={(value) =>
                  updatePreferences({ preferredModel: value })
                }
                onGenerateSuggestion={() => void generateSuggestion()}
                onCannedOpenChange={changeCannedOpen}
                onCannedQueryChange={setCannedQuery}
                onCannedCategoryChange={setCannedCategory}
                onInsertCanned={insertCanned}
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
