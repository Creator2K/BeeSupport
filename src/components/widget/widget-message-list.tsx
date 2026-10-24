"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { MessageBubble } from "@/components/agent/message-bubble";
import type { SiteConfig } from "@/components/widget/widget-types";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

import { WidgetClosedCard } from "./widget-closed-card";

export function WidgetMessageList({
  config,
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
  onLoadOlder,
  onRatingValueChange,
  onRatingCommentChange,
  onSubmitRating,
  onStartNew,
}: {
  config: SiteConfig | null;
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
  token: string | null;
  agentTyping: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  showOfflineNotice: boolean;
  ratingValue: number;
  ratingComment: string;
  ratingSubmitted: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onLoadOlder: () => void;
  onRatingValueChange: (value: number) => void;
  onRatingCommentChange: (value: string) => void;
  onSubmitRating: () => void;
  onStartNew: () => void;
}) {
  const t = useT();
  const isClosed = conversation?.status === "CLOSED";

  return (
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
          onClick={onLoadOlder}
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
          onRatingValueChange={onRatingValueChange}
          onRatingCommentChange={onRatingCommentChange}
          onSubmitRating={onSubmitRating}
          onStartNew={onStartNew}
        />
      ) : null}
    </div>
  );
}