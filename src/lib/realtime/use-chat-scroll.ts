"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useChatScroll({
  conversationId,
  messageCount,
  lastMessageId,
  activity,
}: {
  conversationId: string | null;
  messageCount: number;
  lastMessageId: string | undefined;
  activity?: string | boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<{ height: number; top: number } | null>(null);
  const followLatestRef = useRef(true);
  const forceLatestRef = useRef(false);
  const previous = useRef({ conversationId, lastMessageId });
  const [newMessagesBelow, setNewMessagesBelow] = useState(false);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
    followLatestRef.current = nearBottom;
    if (nearBottom) setNewMessagesBelow(false);
  }, []);

  const scrollToLatest = useCallback(() => {
    followLatestRef.current = true;
    forceLatestRef.current = true;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setNewMessagesBelow(false);
  }, []);

  const preserveHistoryPosition = useCallback(() => {
    const element = scrollRef.current;
    if (element)
      historyScrollRef.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
      };
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const switched = previous.current.conversationId !== conversationId;
    if (switched) {
      historyScrollRef.current = null;
      followLatestRef.current = true;
      setNewMessagesBelow(false);
    }

    const history = historyScrollRef.current;
    if (history && !forceLatestRef.current) {
      element.scrollTop = history.top + element.scrollHeight - history.height;
      historyScrollRef.current = null;
      onScroll();
    } else if (followLatestRef.current || forceLatestRef.current) {
      element.scrollTop = element.scrollHeight;
      historyScrollRef.current = null;
      setNewMessagesBelow(false);
    } else if (
      lastMessageId &&
      previous.current.lastMessageId !== lastMessageId
    ) {
      setNewMessagesBelow(true);
    }
    forceLatestRef.current = false;
    previous.current = { conversationId, lastMessageId };
  }, [conversationId, messageCount, lastMessageId, activity, onScroll]);

  return {
    scrollRef,
    onScroll,
    scrollToLatest,
    preserveHistoryPosition,
    newMessagesBelow,
  };
}
