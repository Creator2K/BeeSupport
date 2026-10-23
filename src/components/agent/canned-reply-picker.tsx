"use client";

import { Zap } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { CannedItem } from "./workbench-types";

type CannedReplyPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: string[];
  loading: boolean;
  error: boolean;
  items: CannedItem[];
  inserting: boolean;
  hasMore: boolean;
  onInsert: (item: CannedItem) => Promise<void>;
};

export function CannedReplyPicker({
  open,
  onOpenChange,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  categories,
  loading,
  error,
  items,
  inserting,
  hasMore,
  onInsert,
}: CannedReplyPickerProps) {
  const t = useT();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          title={t("workbench.canned")}
          aria-label={t("workbench.canned")}
        >
          <Zap className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t("workbench.canned")}
        className="w-80 max-w-[calc(100vw-2rem)] p-2"
      >
        <Input
          aria-label={t("workbench.cannedSearch")}
          maxLength={120}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("workbench.cannedSearch")}
          className="mb-2 h-8 text-xs"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              items.length === 1
            ) {
              event.preventDefault();
              void onInsert(items[0]);
            }
          }}
        />
        <select
          aria-label={t("canned.category")}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
          className="mb-2 h-8 w-full rounded-md border bg-background px-2 text-xs"
        >
          <option value="">{t("canned.allCategories")}</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <div className="max-h-64 space-y-1 overflow-y-auto" aria-busy={loading}>
          {loading ? (
            <p role="status" className="py-4 text-center text-xs">
              {t("canned.loading")}
            </p>
          ) : error ? (
            <p
              role="alert"
              className="py-4 text-center text-xs text-red-800 dark:text-red-300"
            >
              {t("canned.loadFailed")}
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              {t("common.empty")}
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={inserting}
                className="hover:bg-accent w-full rounded-md px-2 py-1.5 text-left disabled:opacity-50"
                onClick={() => void onInsert(item)}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 break-all text-xs font-medium">
                    {item.title}
                  </span>
                  {item.category && (
                    <span className="max-w-full break-all rounded border px-1 text-[10px]">
                      {item.category}
                    </span>
                  )}
                  {!item.shared && (
                    <span className="rounded border px-1 text-[10px]">
                      {t("canned.private")}
                    </span>
                  )}
                  {item.shortcut ? (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      /{item.shortcut}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground line-clamp-2 break-all text-[11px]">
                  {item.content}
                </span>
              </button>
            ))
          )}
        </div>
        {!loading && hasMore && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("canned.moreHint")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
