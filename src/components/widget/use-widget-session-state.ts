"use client";

import { useRef, useState } from "react";

import type {
  Availability,
  SiteConfig,
} from "@/components/widget/widget-types";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

export type WidgetChatMode = "loading" | "error" | "form" | "chat";
export type PageState = { url: string; title: string };

export function useWidgetSessionState() {
  const [mode, setMode] = useState<WidgetChatMode>("loading");
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
  const [unread, setUnread] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversation?.id ?? null;

  return {
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
  };
}
