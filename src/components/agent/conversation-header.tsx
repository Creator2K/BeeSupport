"use client";

import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  RotateCcw,
  Zap,
} from "lucide-react";

import { FollowUpLauncher } from "@/components/follow-ups/follow-up-launcher";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import type { SerializedConversation } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

type ConversationHeaderProps = {
  conversation: SerializedConversation;
  typingConversationId: string | null;
  actionPending: boolean;
  targetsLoading: boolean;
  onBack: () => void;
  onClaim: () => void;
  onTransfer: () => void;
  onReopen: () => void;
  onRequestClose: () => void;
};

export function ConversationHeader({
  conversation,
  typingConversationId,
  actionPending,
  targetsLoading,
  onBack,
  onClaim,
  onTransfer,
  onReopen,
  onRequestClose,
}: ConversationHeaderProps) {
  const t = useT();

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:hidden"
        aria-label={t("common.back")}
        onClick={onBack}
      >
        <ArrowLeft className="size-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {conversation.visitor.name ?? conversation.visitor.email}
          </span>
          <Badge
            variant="secondary"
            className="h-4 max-w-20 truncate px-1.5 text-[10px] sm:max-w-40"
            title={conversation.siteName}
          >
            {conversation.siteName}
          </Badge>
          {conversation.status === "PENDING" ? (
            <Badge className="hidden h-4 bg-amber-500/15 px-1.5 text-[10px] text-amber-800 sm:inline-flex dark:text-amber-300">
              {t("conversations.statusPending")}
            </Badge>
          ) : null}
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "size-1.5 rounded-full",
              conversation.visitor.online
                ? "bg-emerald-500"
                : "bg-zinc-400",
            )}
          />
          {typingConversationId === conversation.id
            ? t("workbench.visitorTyping")
            : conversation.visitor.online
              ? t("workbench.visitorOnline")
              : formatRelative(conversation.visitor.lastSeenAt)}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {conversation.status === "PENDING" ? (
          <Button
            size="sm"
            disabled={actionPending}
            aria-label={t("workbench.claim")}
            onClick={onClaim}
          >
            <Zap className="size-3.5" />
            <span className="ml-1.5 hidden sm:inline">
              {t("workbench.claim")}
            </span>
          </Button>
        ) : null}

        <FollowUpLauncher
          key={conversation.id}
          conversationId={conversation.id}
          compact
        />
        <Button
          variant="outline"
          size="sm"
          disabled={
            actionPending ||
            targetsLoading ||
            conversation.status === "CLOSED"
          }
          onClick={onTransfer}
          aria-label={t("workbench.transfer")}
          title={t("workbench.transfer")}
        >
          <ArrowRightLeft className="size-4 sm:hidden" />
          <span className="hidden sm:inline">{t("workbench.transfer")}</span>
        </Button>

        {conversation.status === "CLOSED" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={actionPending}
            onClick={onReopen}
            aria-label={t("workbench.reopen")}
            title={t("workbench.reopen")}
          >
            <RotateCcw className="size-4 sm:hidden" />
            <span className="hidden sm:inline">{t("workbench.reopen")}</span>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={actionPending}
            onClick={onRequestClose}
            aria-label={t("workbench.close")}
            title={t("workbench.close")}
          >
            <Check className="size-4 sm:hidden" />
            <span className="hidden sm:inline">{t("workbench.close")}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
