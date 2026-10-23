"use client";

import { CircleDashed, Search } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatRelative } from "@/lib/format";
import type { SerializedConversation } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

export type WorkbenchTab = "queue" | "mine" | "all" | "closed";

export type WorkbenchFilters = {
  tab: WorkbenchTab;
  siteId: string;
  query: string;
  unreadOnly: boolean;
};

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
  counts: { pending: number; open: number; unread: number; mine: number };
  meId: string;
  sites: { id: string; name: string }[];
  loading: boolean;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();

  const tabs: { value: WorkbenchTab; label: string; badge?: number }[] = [
    { value: "queue", label: t("workbench.queue"), badge: counts.pending },
    { value: "mine", label: t("workbench.mine"), badge: counts.mine },
    { value: "all", label: t("workbench.all") },
    { value: "closed", label: t("conversations.statusClosed") },
  ];

  const visible = conversations.filter((conversation) => {
    if (filters.tab === "queue" && conversation.status !== "PENDING")
      return false;
    if (
      filters.tab === "mine" &&
      (conversation.assignedAgent?.id !== meId ||
        conversation.status === "CLOSED")
    ) {
      return false;
    }
    if (filters.tab === "all" && conversation.status === "CLOSED") return false;
    if (filters.tab === "closed" && conversation.status !== "CLOSED")
      return false;
    if (filters.siteId !== "all" && conversation.siteId !== filters.siteId) {
      return false;
    }
    if (filters.unreadOnly && conversation.unreadForAgent === 0) return false;
    if (filters.query) {
      const keyword = filters.query.trim().toLowerCase();
      const haystack = [
        conversation.visitor.email,
        conversation.visitor.name ?? "",
        conversation.lastMessagePreview ?? "",
        conversation.subject ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full w-full flex-col border-r sm:w-80">
      <div className="space-y-2 border-b p-2.5">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onFiltersChange({ ...filters, tab: tab.value })}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                filters.tab === tab.value
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.badge ? (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] tabular-nums">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={filters.query}
            onChange={(event) =>
              onFiltersChange({ ...filters, query: event.target.value })
            }
            placeholder={t("workbench.searchPlaceholder")}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={filters.siteId}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, siteId: value })
            }
          >
            <SelectTrigger
              size="sm"
              className="h-7 flex-1 text-xs"
              aria-label={t("workbench.filterSite")}
            >
              <SelectValue placeholder={t("workbench.filterSite")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("workbench.allSites")}</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[11px]">
            <Switch
              checked={filters.unreadOnly}
              onCheckedChange={(value) =>
                onFiltersChange({ ...filters, unreadOnly: value })
              }
              className="scale-90"
            />
            {t("workbench.unreadOnly")}
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs">
            <CircleDashed className="size-5" />
            {filters.tab === "queue"
              ? t("workbench.emptyQueue")
              : t("workbench.emptyList")}
          </div>
        ) : (
          visible.map((conversation) => {
            const active = conversation.id === activeId;
            const name =
              conversation.visitor.name ?? conversation.visitor.email;

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
          })
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
