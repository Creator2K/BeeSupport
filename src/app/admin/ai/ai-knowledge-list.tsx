"use client";

import { Search } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type {
  IndexStats,
  KnowledgeDraft,
  KnowledgeRecord,
} from "./ai-types";

export function AiKnowledgeList({
  entries,
  filteredEntries,
  indexStats,
  query,
  draft,
  onQueryChange,
  onSelectEntry,
}: {
  entries: KnowledgeRecord[];
  filteredEntries: KnowledgeRecord[];
  indexStats: IndexStats;
  query: string;
  draft: KnowledgeDraft | null;
  onQueryChange: (value: string) => void;
  onSelectEntry: (entry: KnowledgeRecord) => void;
}) {
  const t = useT();
  return (
<Card className="shadow-none">
          <CardContent className="space-y-3 p-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={t("ai.knowledgeSearch")}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <p className="text-muted-foreground text-[11px]">
              {t("ai.knowledgeTotal", {
                entries: indexStats.entries,
                chunks: indexStats.chunks,
              })}
            </p>

            <div className="max-h-[560px] space-y-1 overflow-y-auto pr-0.5">
              {filteredEntries.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-xs">
                  {entries.length === 0
                    ? t("ai.knowledgeEmpty")
                    : t("common.empty")}
                </p>
              ) : (
                filteredEntries.map((entry) => {
                  const active = draft?.id === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() =>
                        onSelectEntry(entry)
                      }
                      className={cn(
                        "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                        active
                          ? "border-primary/40 bg-accent"
                          : "hover:bg-accent/60",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {entry.title}
                        </span>
                        {!entry.enabled ? (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[10px]"
                          >
                            {t("common.disabled")}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                        <span className="text-muted-foreground">
                          {entry.siteName ?? t("canned.scopeGlobal")}
                        </span>
                        <span className="text-muted-foreground">?</span>
                        <span className="text-muted-foreground">
                          {t("ai.chunks", { count: entry.chunkCount })}
                        </span>
                      </span>
                      <span className="text-muted-foreground mt-1 line-clamp-2 block text-[11px]">
                        {entry.content}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
  );
}
