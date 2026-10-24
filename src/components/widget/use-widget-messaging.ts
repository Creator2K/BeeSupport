"use client";

import type { Dispatch, SetStateAction } from "react";

import { useT } from "@/components/locale-provider";
import type { Availability, SiteConfig } from "@/components/widget/widget-types";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";
import { useWidgetFileUpload } from "./use-widget-file-upload";
import { useWidgetImageGate } from "./use-widget-image-gate";
import { useWidgetSendMessage } from "./use-widget-send-message";

export function useWidgetMessaging({
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
}: {
  token: string | null;
  config: SiteConfig | null;
  availability: Availability;
  conversation: VisitorConversation | null;
  draft: string;
  messagesRef: { current: SerializedMessage[] };
  conversationIdRef: { current: string | null };
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  scrollToLatest: () => void;
}) {
  const t = useT();
  const gateState = useWidgetImageGate(token);
  const sendState = useWidgetSendMessage({
    token,
    availability,
    conversation,
    draft,
    messagesRef,
    setConversation,
    setMessages,
    setDraft,
    setHasOlder,
    scrollToLatest,
    t,
  });
  const uploadState = useWidgetFileUpload({
    token,
    config,
    availability,
    conversationIdRef,
    setConversation,
    setMessages,
    scrollToLatest,
    imageGate: gateState.imageGate,
    setImageGate: gateState.setImageGate,
    refreshImageGate: gateState.refreshImageGate,
    t,
  });

  return {
    sending: sendState.sending,
    uploading: uploadState.uploading,
    imageGate: gateState.imageGate,
    setImageGate: gateState.setImageGate,
    sendMessage: sendState.sendMessage,
    uploadFile: uploadState.uploadFile,
    recoverImage: uploadState.recoverImage,
    handlePaste: uploadState.handlePaste,
  };
}
