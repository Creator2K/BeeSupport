"use client";

import { CircleDashed } from "lucide-react";

import type { SerializedConversation } from "@/lib/realtime/types";

import { useT } from "@/components/locale-provider";
import { ConversationListFilters } from "./conversation-list-filters";
import { ConversationListItem } from "./conversation-list-item";
import { filterConversations } from "./conversation-list-filter";
import type {
  ConversationListCounts,
  ConversationSiteOption,
  WorkbenchFilters,
} from "./conversation-list-types";

export type {
  WorkbenchFilters,
  WorkbenchTab,
} from "./conversation-list-types";

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  filters,
  onFiltersChange,
  counts,
  meId,
  sites,
  loading,
  page,
  total,
  onPageChange,
}: {
  conversations: SerializedConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  filters: WorkbenchFilters;
  onFiltersChange: (filters: WorkbenchFilters) => void;
  counts: ConversationListCounts;
  meId: string;
  sites: ConversationSiteOption[];
  loading: boolean;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const visible = filterConversations(conversations, filters, meId);

  return (
    <div className="flex h-full w-full flex-col border-r sm:w-80">
      <ConversationListFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        counts={counts}
        sites={sites}
        t={t}
      />

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs">
            <CircleDashed className="size-5" />
            {filters.tab === "queue"
              ? t("workbench.emptyQueue")
              : t("workbench.emptyList")}
          </div>
        ) : (
          visible.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              meId={meId}
              onSelect={onSelect}
              t={t}
            />
          ))
        )}

        {loading ? (
          <div className="text-muted-foreground py-3 text-center text-[11px]">
            {t("common.loading")}
          </div>
        ) : null}
      </div>

      {total > 50 ? (
        <div className="flex items-center justify-between gap-2 border-t p-2 text-xs">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            className="disabled:opacity-40"
          >
            {t("common.previousPage")}
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / 50))}
          </span>
          <button
            type="button"
            disabled={page * 50 >= total || loading}
            onClick={() => onPageChange(page + 1)}
            className="disabled:opacity-40"
          >
            {t("common.nextPage")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
