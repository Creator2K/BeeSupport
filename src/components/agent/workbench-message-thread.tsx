"use client";

import { Loader2 } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";

import { MessageBubble } from "./message-bubble";

export function WorkbenchMessageThread({
  userId,
  onDelete,
  conversation,
  messages,
  loading,
  hasOlder,
  loadingOlder,
  locale,
  scrollRef,
  onScroll,
  onLoadOlder,
}: {
  userId: string;
  onDelete: (message: SerializedMessage) => Promise<void>;
  conversation: SerializedConversation;
  messages: SerializedMessage[];
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  locale: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onLoadOlder: () => void;
}) {
  const t = useT();

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
    >
      {loading && messages.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {conversation.status === "CLOSED" ? (
        <div className="flex justify-center">
          <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[11px]">
            {t("workbench.closedBanner")}
          </span>
        </div>
      ) : null}

      {hasOlder ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={loadingOlder}
          onClick={onLoadOlder}
        >
          {t(loadingOlder ? "common.loading" : "common.loadOlder")}
        </Button>
      ) : null}

      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          mine={message.sender === "AGENT"}
          onDelete={message.sender === "AGENT" && message.authorId === userId &&
            !message.deletedAt && !message.id.startsWith("tmp-") ? () => onDelete(message) : undefined}
          locale={locale}
          receiptAt={message.readByVisitorAt}
          showAiTrace
          allowImageApproval
          labels={{
            deleted: t("workbench.deletedMessage"),
            deleteMessage: t("common.delete"),
            read: t("workbench.readStatus"),
            delivered: t("workbench.delivered"),
            system: t("workbench.systemMessage"),
            note: t("workbench.internalNote"),
            ai: t("workbench.aiLabel"),
            tools: t("workbench.aiTools"),
            knowledge: t("workbench.aiKnowledge"),
          }}
        />
      ))}
    </div>
  );
}
