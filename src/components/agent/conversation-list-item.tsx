"use client";

import { Badge } from "@/components/ui/badge";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatRelative } from "@/lib/format";
import type { SerializedConversation } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

export function ConversationListItem({
  conversation,
  active,
  meId,
  onSelect,
  t,
}: {
  conversation: SerializedConversation;
  active: boolean;
  meId: string;
  onSelect: (id: string) => void;
  t: TranslateFn;
}) {
  const name = conversation.visitor.name ?? conversation.visitor.email;

  return (
    <button
      key={conversation.id}
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={cn(
        "animate-rise flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors duration-150",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span className="relative mt-0.5">
        <span className="bg-muted flex size-7 items-center justify-center rounded-full text-[11px] font-medium">
          {name.slice(0, 1).toUpperCase()}
        </span>
        {conversation.visitor.online ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm">
            {name}
          </span>
          <span className="text-foreground/75 shrink-0 text-[10px]">
            {formatRelative(conversation.lastMessageAt)}
          </span>
        </span>

        <span className="text-foreground/75 mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs">
            {conversation.lastMessagePreview || "—"}
          </span>
          {conversation.unreadForAgent > 0 ? (
            <span className="bg-primary text-primary-foreground shrink-0 rounded-full px-1.5 text-[10px] tabular-nums">
              {conversation.unreadForAgent}
            </span>
          ) : null}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-1">
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] font-normal"
          >
            {conversation.siteName}
          </Badge>
          {conversation.status === "PENDING" ? (
            <Badge className="h-4 bg-amber-500/15 px-1.5 text-[10px] font-normal text-amber-800 dark:text-amber-300">
              {t("conversations.statusPending")}
            </Badge>
          ) : null}
          {conversation.source === "OFFLINE_FORM" ? (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[10px] font-normal"
            >
              {t("conversations.sourceOffline")}
            </Badge>
          ) : null}
          {conversation.assignedAgent &&
          conversation.assignedAgent.id !== meId ? (
            <span className="text-foreground/75 text-[10px]">
              {conversation.assignedAgent.name}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
