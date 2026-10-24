"use client";

import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";

import type {
  KnowledgeDraft,
  KnowledgeRecord,
  SiteOption,
} from "./ai-types";

export function AiKnowledgeEditor({
  draft,
  activeEntry,
  sites,
  dirty,
  knowledgeSaving,
  reindexing,
  onDraftChange,
  onSave,
  onCancel,
  onReindex,
  onDelete,
  onNew,
}: {
  draft: KnowledgeDraft | null;
  activeEntry: KnowledgeRecord | null | undefined;
  sites: SiteOption[];
  dirty: boolean;
  knowledgeSaving: boolean;
  reindexing: string | null;
  onDraftChange: (draft: KnowledgeDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onReindex: (id?: string) => void;
  onDelete: (entry: KnowledgeRecord) => void;
  onNew: () => void;
}) {
  const t = useT();
  return (
    <>
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
                  placeholder="价格, 套餐, 退款"
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
    </>
  );
}
