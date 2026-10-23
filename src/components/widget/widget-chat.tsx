"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { MessageBubble } from "@/components/agent/message-bubble";
import { WidgetClosedCard } from "@/components/widget/widget-closed-card";
import { WidgetComposer } from "@/components/widget/widget-composer";
import { WidgetHeader } from "@/components/widget/widget-header";
import { WidgetIdentityForm } from "@/components/widget/widget-identity-form";
import type {
  Availability,
  SiteConfig,
} from "@/components/widget/widget-types";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import type { ImageGate } from "@/server/services/image-review";
import type { SerializedMessage } from "@/lib/realtime/types";
import type { VisitorConversation } from "@/lib/realtime/public";
import {
  mergeMessageSnapshot,
  mergeMessages,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import {
  prepareSendAttempt,
  type SendAttempt,
} from "@/lib/realtime/send-attempt";
import { useSocket } from "@/lib/realtime/use-socket";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";
import {
  collectVisitorEnv,
  mergeVisitorEnv,
  pickVisitorEnv,
  type VisitorEnv,
} from "@/lib/visitor-env";

type StoredIdentity = { token: string; email: string; name: string | null };

async function fetchState(
  visitorToken: string,
  conversationId?: string | null,
  before?: string,
): Promise<{
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
} | null> {
  try {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (before) params.set("before", before);
    const response = await fetch(`/api/widget/conversation?${params}`, {
      headers: { authorization: `Bearer ${visitorToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      conversation: VisitorConversation | null;
      messages: SerializedMessage[];
    };
  } catch {
    return null;
  }
}

export function WidgetChat({
  siteKey,
  embedToken,
  pageUrl,
  pageTitle,
  referrer,
  host,
}: {
  siteKey: string;
  embedToken: string;
  pageUrl: string;
  pageTitle: string;
  referrer: string;
  host: string;
}) {
  const t = useT();
  const [mode, setMode] = useState<"loading" | "error" | "form" | "chat">(
    "loading",
  );
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [availability, setAvailability] = useState<Availability>({
    online: false,
    agentsOnline: 0,
    withinWorkHours: true,
  });

  // 访客页面轨迹：当前页面 + 环境信息（宿主页面会通过 postMessage 补一份更准的）
  const [page, setPage] = useState({ url: pageUrl, title: pageTitle });
  const envRef = useRef<VisitorEnv>({});
  const trackingLocalKeyRef = useRef("");

  const collectEnv = useCallback(
    (extra: VisitorEnv = {}): VisitorEnv =>
      mergeVisitorEnv(
        mergeVisitorEnv(
          collectVisitorEnv({
            pageUrl: page.url || undefined,
            pageTitle: page.title || undefined,
            referrer: referrer || undefined,
            host: host || undefined,
          }),
          envRef.current,
        ),
        extra,
      ),
    [page.url, page.title, referrer, host],
  );

  // 首屏先用自己的环境，宿主页面稍后会推送更准确的一份
  useEffect(() => {
    envRef.current = collectVisitorEnv({
      pageUrl,
      pageTitle,
      referrer,
      host,
    });
  }, [pageUrl, pageTitle, referrer, host]);

  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [conversation, setConversation] = useState<VisitorConversation | null>(
    null,
  );
  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const sendAttemptRef = useRef<SendAttempt | null>(null);
  const sendingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [imageGate, setImageGate] = useState<ImageGate>({
    enabled: false,
    pending: null,
  });
  const refreshImageGate = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/widget/images", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.ok) setImageGate(await response.json());
    } catch {
      /* Keep the last known gate; the server still enforces it. */
    }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    void refreshImageGate();
    const timer = setInterval(() => void refreshImageGate(), 15000);
    return () => clearInterval(timer);
  }, [token, refreshImageGate]);

  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [parentOpened, setParentOpened] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const {
    scrollRef,
    onScroll,
    scrollToLatest,
    preserveHistoryPosition,
    newMessagesBelow,
  } = useChatScroll({
    conversationId: conversation?.id ?? null,
    messageCount: messages.length,
    lastMessageId: messages.at(-1)?.id,
    activity: `${mode}:${agentTyping}`,
  });
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversation?.id ?? null;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const pageRef = useRef(page);
  pageRef.current = page;
  const collectEnvRef = useRef(collectEnv);
  collectEnvRef.current = collectEnv;
  const reportTrackRef = useRef<
    (target?: { url: string; title: string }, env?: VisitorEnv) => Promise<void>
  >(async () => undefined);

  const { socket, connected } = useSocket({
    auth: { token },
    enabled: Boolean(token),
  });

  /** 页面轨迹上报：SPA 切换或宿主页面推送环境信息时调用 */
  const reportTrack = useCallback(
    async (target?: { url: string; title: string }, env?: VisitorEnv) => {
      const visitorToken = tokenRef.current;
      const current = target ?? pageRef.current;
      if (!current.url) return;
      if (!visitorToken) {
        if (!trackingLocalKeyRef.current) return;
        await fetch("/api/widget/visit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-beesupport-embed": embedToken,
          },
          body: JSON.stringify({
            key: siteKey,
            localKey: trackingLocalKeyRef.current,
            pageUrl: current.url,
            pageTitle: current.title || undefined,
            referrer: referrer || undefined,
            env: env ?? collectEnvRef.current(),
          }),
        }).catch(() => undefined);
        return;
      }

      await fetch("/api/widget/track", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${visitorToken}`,
        },
        body: JSON.stringify({
          pageUrl: current.url,
          pageTitle: current.title || undefined,
          env: env ?? collectEnvRef.current(),
        }),
      }).catch(() => undefined);
    },
    [embedToken, siteKey, referrer],
  );
  reportTrackRef.current = reportTrack;

  const identityStorageKey = siteKey ? `beesupport:visitor:${siteKey}` : "";
  const localKeyStorageKey = siteKey ? `beesupport:localKey:${siteKey}` : "";

  const postToParent = useCallback(
    (message: Record<string, unknown>) => {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage(message, host || "*");
    },
    [host],
  );

  const readIdentity = useCallback((): StoredIdentity | null => {
    if (!identityStorageKey) return null;
    try {
      const raw = window.localStorage.getItem(identityStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredIdentity;
      return parsed?.token ? parsed : null;
    } catch {
      return null;
    }
  }, [identityStorageKey]);

  const ensureLocalKey = useCallback((): string => {
    if (!localKeyStorageKey) return `anon-${Date.now()}-0000`;
    try {
      const existing = window.localStorage.getItem(localKeyStorageKey);
      if (existing && existing.length >= 8 && existing.length <= 64)
        return existing;
    } catch {
      /* Storage may be disabled in embedded browsers. */
    }
    const generated =
      trackingLocalKeyRef.current ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    trackingLocalKeyRef.current = generated;
    try {
      window.localStorage.setItem(localKeyStorageKey, generated);
    } catch {
      /* Keep an in-memory identity for this window. */
    }
    return generated;
  }, [localKeyStorageKey]);

  const markRead = useCallback(
    (conversationId: string) => {
      setUnread(0);
      void fetch("/api/widget/read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ conversationId }),
      }).catch(() => undefined);
    },
    [token],
  );

  // 初始化：站点配置 + 本地身份恢复
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!siteKey) {
        setMode("error");
        return;
      }

      try {
        const response = await fetch(
          `/api/widget/config?key=${encodeURIComponent(siteKey)}`,
          { cache: "no-store", headers: { "x-beesupport-embed": embedToken } },
        );
        if (!response.ok) {
          if (!cancelled) setMode("error");
          return;
        }

        const data = (await response.json()) as {
          site: SiteConfig;
          availability: Availability;
        };
        if (cancelled) return;

        setConfig(data.site);
        setAvailability(data.availability);
        trackingLocalKeyRef.current = ensureLocalKey();
        void reportTrackRef.current();
        postToParent({ type: "beesupport:ready", site: data.site });

        const stored = readIdentity();
        if (stored?.token) {
          const state = await fetchState(stored.token);
          if (cancelled) return;
          if (state) {
            setToken(stored.token);
            setEmail(stored.email ?? "");
            setName(stored.name ?? "");
            setConversation(state.conversation);
            setMessages(state.messages);
            setHasOlder(state.messages.length === 200);
            setUnread(state.conversation?.unreadForVisitor ?? 0);
            if (state.conversation?.rating) {
              setRatingSubmitted(true);
            }
            setMode("chat");
            return;
          }
          window.localStorage.removeItem(identityStorageKey);
        }

        if (stored?.email) setEmail(stored.email);
        if (stored?.name) setName(stored.name);
        setMode("form");
      } catch {
        if (!cancelled) setMode("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    siteKey,
    identityStorageKey,
    readIdentity,
    postToParent,
    embedToken,
    ensureLocalKey,
  ]);

  // 未读数同步给外层气泡
  useEffect(() => {
    postToParent({ type: "beesupport:unread", count: unread });
  }, [unread, postToParent]);

  // 与外层加载器的通信
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string } | null;
      if (
        event.source !== window.parent ||
        (host && event.origin !== host) ||
        !data ||
        typeof data !== "object"
      )
        return;

      if (data.type === "beesupport:opened") {
        setParentOpened(true);
        const conversationId = conversationIdRef.current;
        if (conversationId) markRead(conversationId);
      } else if (data.type === "beesupport:closed") {
        setParentOpened(false);
      } else if (data.type === "beesupport:env") {
        // 宿主页面（真实视口、时区、网络等）送来的环境信息，覆盖 iframe 自己的
        const incoming = (data as { env?: unknown }).env;
        envRef.current = mergeVisitorEnv(
          envRef.current,
          pickVisitorEnv(incoming ?? data),
        );
        void reportTrack(undefined, envRef.current);
      } else if (data.type === "beesupport:navigate") {
        const next = {
          url: String((data as { page?: unknown }).page ?? ""),
          title: String((data as { title?: unknown }).title ?? ""),
        };
        setPage(next);
        void reportTrack(next);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [markRead, reportTrack, host]);

  useEffect(() => {
    if (!socket) return;
    const updateGate = (gate: ImageGate) => setImageGate(gate);
    socket.on("image:gate", updateGate);
    return () => {
      socket.off("image:gate", updateGate);
    };
  }, [socket]);

  // 实时消息
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
        // 不属于当前会话的消息（例如被客服另开了会话）只更新未读
        if (
          payload.message.sender === "AGENT" ||
          payload.message.sender === "AI"
        )
          setUnread((value) => value + 1);
        return;
      }

      setConversation(payload.conversation);
      setMessages((prev) => mergeMessages(prev, [payload.message]));
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
  }, [socket, parentOpened, markRead]);

  // 加入会话房间
  useEffect(() => {
    if (!socket || !connected || !conversation?.id) return;
    socket.emit("conversation:join", { conversationId: conversation.id });
    return () => {
      socket.emit("conversation:leave", { conversationId: conversation.id });
    };
  }, [socket, connected, conversation?.id]);

  // Resync on reconnect and poll as a fallback; always preserve already-loaded history.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const sync = async () => {
      const currentId = conversationIdRef.current;
      const state = await fetchState(token, currentId);
      if (cancelled || currentId !== conversationIdRef.current || !state)
        return;
      setConversation(state.conversation);
      const current = messagesRef.current;
      setMessages((previous) => mergeMessageSnapshot(previous, state.messages));
      setHasOlder((previous) =>
        snapshotHasOlderMessages(current, state.messages, previous),
      );
      if (!parentOpened) setUnread(state.conversation?.unreadForVisitor ?? 0);
    };
    void sync();
    const timer = setInterval(() => void sync(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, connected, parentOpened]);

  async function loadOlder() {
    if (!token || !conversation || !messages[0] || loadingOlder) return;
    setLoadingOlder(true);
    const id = conversation.id;
    try {
      const state = await fetchState(token, id, messages[0].id);
      if (!state || id !== conversationIdRef.current) return;
      preserveHistoryPosition();
      setMessages((previous) => mergeMessages(previous, state.messages));
      setHasOlder(state.messages.length === 200);
    } finally {
      setLoadingOlder(false);
    }
  }

  // 心跳：续期在线状态 + 刷新可用性
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
        /* 忽略网络抖动 */
      }
    };

    // Record the return visit before the REST heartbeat advances lastSeenAt.
    void reportTrackRef.current().then(() => pingRest());
    const socketTimer = setInterval(pingSocket, 30_000);
    const restTimer = setInterval(() => void pingRest(), 60_000);

    return () => {
      clearInterval(socketTimer);
      clearInterval(restTimer);
    };
  }, [token, socket]);

  // 打开即视为已读
  useEffect(() => {
    if (mode !== "chat") return;
    const conversationId = conversation?.id;
    if (!conversationId) return;
    if (
      ((conversation?.unreadForVisitor ?? 0) > 0 || unread > 0) &&
      parentOpened &&
      document.visibilityState === "visible"
    )
      markRead(conversationId);
  }, [
    mode,
    conversation?.id,
    conversation?.unreadForVisitor,
    unread,
    parentOpened,
    markRead,
  ]);

  useEffect(() => {
    const onVisible = () => {
      if (
        parentOpened &&
        document.visibilityState === "visible" &&
        conversationIdRef.current
      )
        markRead(conversationIdRef.current);
    };
    if (window.parent === window) setParentOpened(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [parentOpened, markRead]);

  async function startSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/widget/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-beesupport-embed": embedToken,
        },
        body: JSON.stringify({
          key: siteKey,
          localKey: ensureLocalKey(),
          email: email.trim() || undefined,
          name: name.trim() || undefined,
          env: collectEnv(),
          pageUrl: page.url || pageUrl || undefined,
          pageTitle: page.title || undefined,
          referrer: referrer || undefined,
        }),
      });

      const data = (await response.json()) as {
        token?: string;
        visitor?: { email: string; name: string | null };
        availability?: Availability;
        conversation?: VisitorConversation | null;
        messages?: SerializedMessage[];
        error?: string;
      };

      if (!response.ok || !data.token) {
        setFormError(data.error ?? t("common.operationFailed"));
        return;
      }

      window.localStorage.setItem(
        identityStorageKey,
        JSON.stringify({
          token: data.token,
          email: data.visitor?.email ?? email,
          name: data.visitor?.name ?? name,
        }),
      );

      setToken(data.token);
      if (data.availability) setAvailability(data.availability);
      setConversation(data.conversation ?? null);
      setMessages(data.messages ?? []);
      setHasOlder((data.messages?.length ?? 0) === 200);
      setMode("chat");
    } catch {
      setFormError(t("common.operationFailed"));
    } finally {
      setSubmitting(false);
    }
  }

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
    setMessages((prev) => [...prev, optimistic]);
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
        setMessages((prev) =>
          prev.filter((item) => item.id !== `tmp-${clientId}`),
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
      setMessages((prev) =>
        prev.filter((item) => item.id !== `tmp-${clientId}`),
      );
      setDraft((current) => current || body);
      toast.error(t("widget.sendFailed"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function sendUploadedAttachment(
    attachmentId: string,
    targetId?: string | null,
  ): Promise<boolean> {
    const id = targetId || conversationIdRef.current;
    const response = await fetch("/api/widget/conversation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: id || undefined,
        body: "",
        attachmentIds: [attachmentId],
        clientId: `image:${attachmentId}`,
        ...(!id
          ? { source: availability.online ? "WIDGET" : "OFFLINE_FORM" }
          : {}),
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast.error(data.error || t("widget.sendFailed"));
      await refreshImageGate();
      return false;
    }
    const data = (await response.json()) as {
      conversation?: VisitorConversation | null;
      messages?: SerializedMessage[];
    };
    scrollToLatest();
    setConversation(data.conversation ?? null);
    setMessages((previous) =>
      mergeMessageSnapshot(previous, data.messages ?? []),
    );
    setImageGate((previous) =>
      previous.pending?.id === attachmentId
        ? {
            ...previous,
            pending: {
              ...previous.pending,
              sent: true,
              conversationId: data.conversation?.id ?? null,
            },
          }
        : previous,
    );
    await refreshImageGate();
    return true;
  }

  async function uploadFile(file: File): Promise<boolean> {
    const image = file.type.toLowerCase().startsWith("image/");
    if (image ? !config?.imagesEnabled : !config?.filesEnabled) {
      toast.error(image ? "此站点已关闭图片发送" : "此站点已关闭文件发送");
      return false;
    }
    if (file.size > (config?.maxUploadMB ?? 10) * 1048576) {
      toast.error(`文件不能超过 ${config?.maxUploadMB ?? 10} MB`);
      return false;
    }
    if (!token || uploadingRef.current) return false;
    if (
      file.type.startsWith("image/") &&
      imageGate.enabled &&
      imageGate.pending
    ) {
      toast.error(t("images.oneAtATime"));
      return false;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/widget/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error || t("widget.uploadFailed"));
        await refreshImageGate();
        return false;
      }
      const { attachment } = (await response.json()) as {
        attachment: { id: string; imageReviewState?: string };
      };
      if (attachment.imageReviewState === "PENDING")
        setImageGate({
          enabled: true,
          pending: { id: attachment.id, sent: false, conversationId: null },
        });
      return await sendUploadedAttachment(attachment.id);
    } catch {
      toast.error(t("widget.uploadFailed"));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
    return false;
  }

  async function recoverImage(cancel = false) {
    const pending = imageGate.pending;
    if (!token || !pending || pending.sent || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      if (cancel) {
        const response = await fetch("/api/widget/images", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ attachmentId: pending.id }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || t("common.operationFailed"));
        setImageGate(data);
      } else await sendUploadedAttachment(pending.id, pending.conversationId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("widget.uploadFailed"),
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  async function submitRating() {
    if (!token || !conversation || ratingValue === 0) return;
    const response = await fetch("/api/widget/rate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        rating: ratingValue,
        comment: ratingComment || undefined,
      }),
    });
    if (response.ok) setRatingSubmitted(true);
  }

  function startNewConversation() {
    setConversation(null);
    setMessages([]);
    setHasOlder(false);
    setRatingValue(0);
    setRatingComment("");
    setRatingSubmitted(false);
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
    if (files.length === 0) return; // 纯文字粘贴走浏览器默认行为
    if (
      imageGate.enabled &&
      files.filter((file) => file.type.startsWith("image/")).length > 1
    ) {
      event.preventDefault();
      toast.error(t("images.oneAtATime"));
      return;
    }

    event.preventDefault();
    let allSucceeded = true;
    for (const file of files.slice(0, 4)) {
      allSucceeded = (await uploadFile(file)) && allSucceeded;
    }
    if (allSucceeded) toast.success(t("widget.imageAttached"));
  }

  const isClosed = conversation?.status === "CLOSED";
  const showOfflineNotice = !availability.online && !conversation;
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <WidgetHeader
        config={config}
        online={availability.online}
        onClose={() => postToParent({ type: "beesupport:close" })}
      />

      {mode === "loading" ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("widget.loading")}
        </div>
      ) : null}

      {mode === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <MessageSquare className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-sm">
            {t("widget.connectionLost")}
          </p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {t("widget.retry")}
          </Button>
        </div>
      ) : null}

      {mode === "form" ? (
        <WidgetIdentityForm
          config={config}
          online={availability.online}
          email={email}
          name={name}
          formError={formError}
          submitting={submitting}
          onEmailChange={setEmail}
          onNameChange={setName}
          onSubmit={(event) => void startSession(event)}
        />
      ) : null}

      {mode === "chat" ? (
        <>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4"
          >
            {config?.welcomeMessage ? (
              <div className="flex gap-2">
                <div className="bg-muted max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed">
                  {config.welcomeMessage}
                </div>
              </div>
            ) : null}

            {showOfflineNotice ? (
              <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs">
                <p className="font-medium">{t("widget.offlineTitle")}</p>
                <p className="text-muted-foreground mt-0.5 leading-relaxed">
                  {config?.offlineMessage ?? t("widget.offlineHint")}
                </p>
              </div>
            ) : null}

            {conversation?.status === "PENDING" ? (
              <div className="flex justify-center">
                <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[11px]">
                  {t("widget.waiting")}
                </span>
              </div>
            ) : null}

            {hasOlder ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {t(loadingOlder ? "common.loading" : "common.loadOlder")}
              </Button>
            ) : null}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                visitorToken={token}
                mine={message.sender === "VISITOR"}
                receiptAt={message.readByAgentAt}
                labels={{
                  read: t("workbench.readStatus"),
                  delivered: t("workbench.delivered"),
                  system: t("workbench.systemMessage"),
                  note: t("workbench.internalNote"),
                  ai: t("widget.aiLabel"),
                  tools: t("workbench.aiTools"),
                  knowledge: t("workbench.aiKnowledge"),
                }}
              />
            ))}

            {agentTyping ? (
              <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <span className="bg-muted inline-flex gap-0.5 rounded-full px-2 py-1">
                  <span className="size-1 animate-bounce rounded-full bg-current" />
                  <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
                  <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
                </span>
                {t("widget.agentTyping")}
              </div>
            ) : null}

            {isClosed ? (
              <WidgetClosedCard
                ratingEnabled={Boolean(config?.ratingEnabled)}
                ratingSubmitted={ratingSubmitted}
                existingRating={conversation?.rating}
                ratingValue={ratingValue}
                ratingComment={ratingComment}
                onRatingValueChange={setRatingValue}
                onRatingCommentChange={setRatingComment}
                onSubmitRating={() => void submitRating()}
                onStartNew={startNewConversation}
              />
            ) : null}
          </div>

          <WidgetComposer
            config={config}
            composerRef={composerRef}
            draft={draft}
            sending={sending}
            uploading={uploading}
            newMessagesBelow={newMessagesBelow}
            imageGate={imageGate}
            onDraftChange={setDraft}
            onTyping={() => {
              if (socket && conversation?.id) {
                socket.emit("typing", {
                  conversationId: conversation.id,
                  isTyping: true,
                });
              }
            }}
            onSend={() => void sendMessage()}
            onPaste={(event) => void handlePaste(event)}
            onUpload={(file) => void uploadFile(file)}
            onRecoverImage={(cancel) => void recoverImage(cancel)}
            onScrollToLatest={scrollToLatest}
          />
        </>
      ) : null}
    </div>
  );
}
