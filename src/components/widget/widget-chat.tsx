"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import { WidgetComposer } from "@/components/widget/widget-composer";
import { WidgetHeader } from "@/components/widget/widget-header";
import { WidgetIdentityForm } from "@/components/widget/widget-identity-form";
import { WidgetMessageList } from "@/components/widget/widget-message-list";
import { useWidgetMessaging } from "@/components/widget/use-widget-messaging";
import { useWidgetTracking } from "@/components/widget/use-widget-tracking";
import { useWidgetRealtime } from "@/components/widget/use-widget-realtime";
import type {
  Availability,
  SiteConfig,
} from "@/components/widget/widget-types";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import type { SerializedMessage } from "@/lib/realtime/types";
import type { VisitorConversation } from "@/lib/realtime/public";
import { mergeMessages } from "@/lib/realtime/messages";
import { useSocket } from "@/lib/realtime/use-socket";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";

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

  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
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

  const { socket, connected } = useSocket({
    auth: { token },
    enabled: Boolean(token),
  });


  const {
    sending,
    uploading,
    imageGate,
    setImageGate,
    sendMessage,
    uploadFile,
    recoverImage,
    handlePaste,
  } = useWidgetMessaging({
    token,
    config,
    availability,
    conversation,
    draft,
    messagesRef,
    conversationIdRef,
    setConversation,
    setMessages,
    setDraft,
    setHasOlder,
    scrollToLatest,
  });
  const {
    page,
    parentOpened,
    collectEnv,
    reportTrackRef,
    postToParent,
    readIdentity,
    ensureLocalKey,
    markRead,
    identityStorageKey,
  } = useWidgetTracking({
    siteKey,
    embedToken,
    pageUrl,
    pageTitle,
    referrer,
    host,
    token,
    unread,
    setUnread,
    conversationIdRef,
  });

  useWidgetRealtime({
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
  });

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
        ensureLocalKey();
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
    reportTrackRef,
  ]);


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
          <WidgetMessageList
            config={config}
            conversation={conversation}
            messages={messages}
            token={token}
            agentTyping={agentTyping}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            showOfflineNotice={showOfflineNotice}
            ratingValue={ratingValue}
            ratingComment={ratingComment}
            ratingSubmitted={ratingSubmitted}
            scrollRef={scrollRef}
            onScroll={onScroll}
            onLoadOlder={() => void loadOlder()}
            onRatingValueChange={setRatingValue}
            onRatingCommentChange={setRatingComment}
            onSubmitRating={() => void submitRating()}
            onStartNew={startNewConversation}
          />

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
