"use client";

import { useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { useWidgetMessaging } from "@/components/widget/use-widget-messaging";
import { useWidgetRealtime } from "@/components/widget/use-widget-realtime";
import {
  useWidgetSessionActions,
  useWidgetSessionState,
} from "@/components/widget/use-widget-session";
import { useWidgetTracking } from "@/components/widget/use-widget-tracking";
import { fetchWidgetState } from "@/components/widget/widget-session-api";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";
import { useSocket } from "@/lib/realtime/use-socket";

export function useWidgetChat({
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
    siteKey: config?.publicKey ?? "",
    embedToken,
    socket,
    connected,
    token,
    parentOpened,
    conversationIdRef,
    messagesRef,
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
  return {
    t,
    mode,
    config,
    availability,
    postToParent,
    email,
    name,
    formError,
    submitting,
    startSession,
    setEmail,
    setName,
    conversation,
    messages,
    token,
    agentTyping,
    hasOlder,
    loadingOlder,
    showOfflineNotice,
    ratingValue,
    ratingComment,
    ratingSubmitted,
    scrollRef,
    onScroll,
    loadOlder,
    setRatingValue,
    setRatingComment,
    submitRating,
    startNewConversation,
    composerRef,
    draft,
    setDraft,
    sending,
    uploading,
    newMessagesBelow,
    imageGate,
    socket,
    sendMessage,
    handlePaste,
    uploadFile,
    recoverImage,
    scrollToLatest,
  };
}

export type WidgetChatController = ReturnType<typeof useWidgetChat>;
