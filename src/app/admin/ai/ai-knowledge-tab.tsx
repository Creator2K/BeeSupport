"use client";

import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type {
  IndexStats,
  KnowledgeDraft,
  KnowledgeRecord,
  SiteOption,
} from "./ai-types";

type AiKnowledgeTabProps = {
  entries: KnowledgeRecord[];
  filteredEntries: KnowledgeRecord[];
  sites: SiteOption[];
  indexStats: IndexStats;
  query: string;
  draft: KnowledgeDraft | null;
  activeEntry: KnowledgeRecord | null | undefined;
  dirty: boolean;
  knowledgeSaving: boolean;
  reindexing: string | null;
  onQueryChange: (value: string) => void;
  onSelectEntry: (entry: KnowledgeRecord) => void;
  onDraftChange: (draft: KnowledgeDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onReindex: (id?: string) => void;
  onDelete: (entry: KnowledgeRecord) => void;
  onNew: () => void;
};

export function AiKnowledgeTab({
  entries,
  filteredEntries,
  sites,
  indexStats,
  query,
  draft,
  activeEntry,
  dirty,
  knowledgeSaving,
  reindexing,
  onQueryChange,
  onSelectEntry,
  onDraftChange,
  onSave,
  onCancel,
  onReindex,
  onDelete,
  onNew,
}: AiKnowledgeTabProps) {
  const t = useT();

  return (
    <TabsContent value="knowledge" className="mt-4">
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
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

        {draft ? (
          <Card className="shadow-none">
            <CardHeader className="items-center gap-2">
              <CardTitle className="text-base">
                {draft.id ? t("ai.knowledgeEdit") : t("ai.knowledgeNew")}
              </CardTitle>
              <CardDescription>
                {draft.id
                  ? t("ai.knowledgeChunkHint", {
                      count: activeEntry?.chunkCount ?? 0,
                    })
                  : t("ai.knowledgeHint")}
              </CardDescription>
              {dirty ? (
                <CardAction>
                  <Badge
                    variant="secondary"
                    className="h-5 shrink-0 px-2 text-[10px]"
                  >
                    {t("ai.knowledgeUnsaved")}
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kb-title">{t("ai.knowledgeTitle")}</Label>
                <Input
                  id="kb-title"
                  value={draft.title}
                  onChange={(event) =>
                    onDraftChange({ ...draft, title: event.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kb-keywords">{t("ai.knowledgeKeywords")}</Label>
                <Input
                  id="kb-keywords"
                  value={draft.keywords}
                  placeholder="??, ??, ???"
                  onChange={(event) =>
                    onDraftChange({ ...draft, keywords: event.target.value })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai.knowledgeKeywordsHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kb-content">{t("ai.knowledgeContent")}</Label>
                <Textarea
                  id="kb-content"
                  rows={18}
                  className="min-h-[380px] text-sm leading-relaxed"
                  value={draft.content}
                  onChange={(event) =>
                    onDraftChange({ ...draft, content: event.target.value })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai.knowledgeContentLength", {
                    count: draft.content.length,
                  })}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("ai.knowledgeScope")}</Label>
                  <Select
                    value={draft.siteId}
                    onValueChange={(value) =>
                      onDraftChange({ ...draft, siteId: value })
                    }
                  >
                    <SelectTrigger aria-label={t("canned.scope")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__global__">
                        {t("canned.scopeGlobal")}
                      </SelectItem>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-3 pb-1.5">
                  <Label className="text-sm font-normal">
                    {t("ai.knowledgeEnabled")}
                  </Label>
                  <Switch
                    aria-label={t("ai.knowledgeEnabled")}
                    checked={draft.enabled}
                    onCheckedChange={(value) =>
                      onDraftChange({ ...draft, enabled: value })
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  type="button"
                  disabled={knowledgeSaving}
                  onClick={onSave}
                >
                  {knowledgeSaving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  <span className="ml-1.5">{t("common.save")}</span>
                </Button>
                <Button type="button" variant="outline" onClick={onCancel}>
                  {t("common.cancel")}
                </Button>
                {draft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onReindex(draft.id ?? undefined)}
                    disabled={reindexing !== null}
                  >
                    {reindexing === draft.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    <span className="ml-1.5">{t("ai.reindexOne")}</span>
                  </Button>
                ) : null}
                {activeEntry ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive ml-auto"
                    onClick={() => onDelete(activeEntry)}
                  >
                    <Trash2 className="size-4" />
                    <span className="ml-1.5">{t("common.delete")}</span>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            title={t("ai.knowledgePick")}
            description={t("ai.knowledgeHint")}
            action={
              <Button size="sm" onClick={onNew}>
                <Plus className="size-4" />
                <span className="ml-1.5">{t("ai.knowledgeNew")}</span>
              </Button>
            }
          />
        )}
      </div>
    </TabsContent>
  );
}
