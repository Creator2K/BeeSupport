"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDateTime } from "@/lib/format";
import { mergeMessages } from "@/lib/realtime/messages";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";

export function ConversationDetailDialog({
  conversationId,
  onClose,
}: {
  conversationId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] =
    useState<SerializedConversation | null>(null);
  const [messages, setMessages] = useState<SerializedMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(false);
  const [failedBefore, setFailedBefore] = useState<string | undefined>();
  const requestRef = useRef<AbortController | null>(null);
  const { scrollRef, onScroll, preserveHistoryPosition } = useChatScroll({
    conversationId,
    messageCount: messages.length,
    lastMessageId: messages.at(-1)?.id,
  });

  const loadPage = useCallback(
    async (before?: string) => {
      if (!conversationId || requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      if (before) setLoadingOlder(true);
      else setLoading(true);
      setError(false);
      try {
        const query = before ? `?before=${encodeURIComponent(before)}` : "";
        const response = await fetch(
          `/api/agent/conversations/${conversationId}${query}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("Conversation unavailable");
        const data = (await response.json()) as {
          conversation: SerializedConversation;
          messages: SerializedMessage[];
        };
        if (controller.signal.aborted) return;
        if (before) preserveHistoryPosition();
        setConversation(data.conversation);
        setMessages((previous) =>
          before ? mergeMessages(previous, data.messages) : data.messages,
        );
        setHasOlder(data.messages.length === 200);
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setFailedBefore(before);
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
          setLoadingOlder(false);
        }
      }
    },
    [conversationId, preserveHistoryPosition],
  );

  useEffect(() => {
    void loadPage();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadPage]);

  return (
    <Dialog
      open={Boolean(conversationId)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("conversations.detail")}</DialogTitle>
          <DialogDescription>
            {conversation
              ? `${conversation.siteName} · ${conversation.visitor.email}`
              : t("common.loading")}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t("common.operationFailed")}</p>
            <Button
              variant="outline"
              onClick={() => void loadPage(failedBefore)}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("conversations.loadingMessages")}
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="max-h-[60dvh] space-y-3 overflow-y-auto pr-1"
          >
            {hasOlder ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={loadingOlder}
                onClick={() => void loadPage(messages[0]?.id)}
              >
                {loadingOlder ? t("common.loading") : t("common.loadOlder")}
              </Button>
            ) : null}
            {conversation?.subject ? (
              <p className="text-sm font-medium">{conversation.subject}</p>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.sender === "SYSTEM"
                    ? "text-center"
                    : message.sender === "AGENT"
                      ? "flex justify-end"
                      : "flex justify-start"
                }
              >
                {message.sender === "SYSTEM" ? (
                  <span className="text-muted-foreground text-xs">
                    {message.body}
                  </span>
                ) : (
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      message.sender === "AGENT"
                        ? "bg-primary text-primary-foreground"
                        : message.type === "NOTE"
                          ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                          : "bg-muted"
                    }`}
                  >
                    <div className="chat-text">{message.body}</div>
                    {message.attachments.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {message.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-xs underline underline-offset-2"
                          >
                            {attachment.filename} ·{" "}
                            {formatBytes(attachment.size)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[10px] opacity-60">
                      {formatDateTime(message.createdAt)}
                      {message.type === "NOTE"
                        ? ` · ${t("workbench.internalNote")}`
                        : ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {conversation?.rating ? (
          <div className="border-t pt-3">
            <Badge variant="secondary" className="text-[11px]">
              {t("conversations.rating")} {conversation.rating}/5
            </Badge>
            {conversation.ratingComment ? (
              <p className="text-muted-foreground mt-1.5 text-xs">
                {conversation.ratingComment}
              </p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
