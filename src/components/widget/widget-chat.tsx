"use client";

import { useRef, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { useWidgetMessaging } from "@/components/widget/use-widget-messaging";
import { useWidgetRealtime } from "@/components/widget/use-widget-realtime";
import {
  useWidgetSessionActions,
  useWidgetSessionState,
} from "@/components/widget/use-widget-session";
import { useWidgetTracking } from "@/components/widget/use-widget-tracking";
import { fetchWidgetState } from "@/components/widget/widget-session-api";
import { WidgetComposer } from "@/components/widget/widget-composer";
import { WidgetHeader } from "@/components/widget/widget-header";
import { WidgetIdentityForm } from "@/components/widget/widget-identity-form";
import { WidgetMessageList } from "@/components/widget/widget-message-list";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";
import { useSocket } from "@/lib/realtime/use-socket";
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
  const {
    mode,
    setMode,
    config,
    setConfig,
    availability,
    setAvailability,
    token,
    setToken,
    email,
    setEmail,
    name,
    setName,
    formError,
    setFormError,
    submitting,
    setSubmitting,
    conversation,
    setConversation,
    messages,
    setMessages,
    messagesRef,
    unread,
    setUnread,
    hasOlder,
    setHasOlder,
    loadingOlder,
    setLoadingOlder,
    ratingValue,
    setRatingValue,
    ratingComment,
    setRatingComment,
    ratingSubmitted,
    setRatingSubmitted,
    conversationIdRef,
  } = useWidgetSessionState();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);

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
    fetchState: fetchWidgetState,
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

  const {
    startSession,
    loadOlder,
    submitRating,
    startNewConversation,
  } = useWidgetSessionActions({
    siteKey,
    embedToken,
    pageUrl,
    referrer,
    page,
    collectEnv,
    ensureLocalKey,
    readIdentity,
    postToParent,
    reportTrackRef,
    identityStorageKey,
    token,
    conversation,
    messages,
    loadingOlder,
    email,
    name,
    ratingValue,
    ratingComment,
    conversationIdRef,
    preserveHistoryPosition,
    setMode,
    setConfig,
    setAvailability,
    setToken,
    setEmail,
    setName,
    setFormError,
    setSubmitting,
    setConversation,
    setMessages,
    setHasOlder,
    setLoadingOlder,
    setUnread,
    setRatingValue,
    setRatingComment,
    setRatingSubmitted,
  });


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
