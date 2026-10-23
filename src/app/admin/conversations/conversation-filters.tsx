"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type {
  ConversationFilters as ConversationFiltersValue,
  SiteOption,
} from "./conversation-types";

const STATUS_OPTIONS = [
  { value: "__all__", labelKey: "common.all" },
  { value: "PENDING", labelKey: "conversations.statusPending" },
  { value: "OPEN", labelKey: "conversations.statusOpen" },
  { value: "CLOSED", labelKey: "conversations.statusClosed" },
] as const;

export function ConversationFilters({
  filters,
  sites,
  total,
  onApply,
}: {
  filters: ConversationFiltersValue;
  sites: SiteOption[];
  total: number;
  onApply: (patch: Partial<ConversationFiltersValue>) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(filters.query);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative flex-1 sm:max-w-xs"
        onSubmit={(event) => {
          event.preventDefault();
          onApply({ query });
        }}
      >
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("conversations.searchPlaceholder")}
          className="h-8 pl-8 text-sm"
        />
      </form>

      <Select
        value={filters.status || "__all__"}
        onValueChange={(value) =>
          onApply({ status: value === "__all__" ? "" : value })
        }
      >
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.siteId || "__all__"}
        onValueChange={(value) =>
          onApply({ siteId: value === "__all__" ? "" : value })
        }
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t("common.all")}</SelectItem>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground ml-auto text-xs">
        {t("common.total")} {total} {t("common.items")}
      </span>
    </div>
  );
}
