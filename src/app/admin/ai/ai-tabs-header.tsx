"use client";

import { Loader2, Plus, RefreshCw, Save, Sparkles } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AiTabsHeader({
  tab,
  entryCount,
  reindexing,
  testing,
  saving,
  onReindexAll,
  onNewEntry,
  onTest,
  onSave,
}: {
  tab: string;
  entryCount: number;
  reindexing: string | null;
  testing: boolean;
  saving: boolean;
  onReindexAll: () => void;
  onNewEntry: () => void;
  onTest: () => void;
  onSave: () => void;
}) {
  const t = useT();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabsList>
        <TabsTrigger value="connection">{t("ai.tabConnection")}</TabsTrigger>
        <TabsTrigger value="prompt">{t("ai.tabPrompt")}</TabsTrigger>
        <TabsTrigger value="knowledge">
          {t("ai.tabKnowledge")}
          <Badge
            variant="secondary"
            className="ml-1.5 h-4 px-1.5 text-[10px]"
          >
            {entryCount}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {tab === "knowledge" ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reindexing !== null}
            onClick={onReindexAll}
          >
            {reindexing === "__all__" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="ml-1.5">{t("ai.reindex")}</span>
          </Button>
          <Button size="sm" onClick={onNewEntry}>
            <Plus className="size-3.5" />
            <span className="ml-1.5">{t("ai.knowledgeNew")}</span>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing}
            onClick={onTest}
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span className="ml-1.5">{t("ai.test")}</span>
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={onSave}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span className="ml-1.5">{t("ai.save")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
