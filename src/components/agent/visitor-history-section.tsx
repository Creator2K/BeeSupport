"use client";

import { History, RefreshCw } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import type { VisitorConversationSummary } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

type VisitorHistorySectionProps = {
  history: VisitorConversationSummary[];
  loading: boolean;
  onRefresh: () => void;
  onOpenConversation?: (conversationId: string) => void;
};

export function VisitorHistorySection({
  history,
  loading,
  onRefresh,
  onOpenConversation,
}: VisitorHistorySectionProps) {
  const t = useT();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{t("workbench.history")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6"
          onClick={onRefresh}
          title={t("common.refresh")}
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </Button>
      </div>

      {history.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">
          {t("workbench.historyEmpty")}
        </p>
      ) : (
        <div className="max-h-52 space-y-1 overflow-y-auto pr-0.5">
          {history.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenConversation?.(item.id)}
              className="hover:bg-accent w-full rounded-md border px-2 py-1.5 text-left transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <History className="text-muted-foreground size-3 shrink-0" />
                <span className="flex-1 truncate text-[11px]">
                  {item.subject ||
                    item.lastMessagePreview ||
                    item.id.slice(0, 8)}
                </span>
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 px-1 text-[10px]"
                >
                  {item.status === "CLOSED"
                    ? t("conversations.statusClosed")
                    : item.status === "PENDING"
                      ? t("conversations.statusPending")
                      : t("conversations.statusOpen")}
                </Badge>
              </span>
              <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                <span>{formatDateTime(item.createdAt)}</span>
                <span>?</span>
                <span>{item.messageCount}</span>
                {item.agentName ? (
                  <>
                    <span>?</span>
                    <span className="truncate">{item.agentName}</span>
                  </>
                ) : null}
                {item.rating ? (
                  <>
                    <span>?</span>
                    <span>{"?".repeat(item.rating)}</span>
                  </>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
