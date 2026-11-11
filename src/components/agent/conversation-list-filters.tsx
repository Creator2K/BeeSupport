"use client";

import { Search } from "lucide-react";

import type { TranslateFn } from "@/lib/i18n/translate";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  ConversationListCounts,
  ConversationSiteOption,
  WorkbenchFilters,
  WorkbenchTab,
} from "./conversation-list-types";

export function ConversationListFilters({
  filters,
  onFiltersChange,
  counts,
  sites,
  t,
}: {
  filters: WorkbenchFilters;
  onFiltersChange: (filters: WorkbenchFilters) => void;
  counts: ConversationListCounts;
  sites: ConversationSiteOption[];
  t: TranslateFn;
}) {
  const tabs: { value: WorkbenchTab; label: string; badge?: number }[] = [
    { value: "queue", label: t("workbench.queue"), badge: counts.pending },
    { value: "mine", label: t("workbench.mine"), badge: counts.mine },
    { value: "all", label: t("workbench.all") },
    { value: "closed", label: t("conversations.statusClosed") },
  ];

  return (
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
              <span className="bg-brand text-brand-foreground rounded-full px-1.5 text-[10px] font-semibold tabular-nums">
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
  );
}
