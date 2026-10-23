"use client";

import { Tabs } from "@/components/ui/tabs";

import { AiConnectionTab } from "./ai-connection-tab";
import { AiKnowledgeDeleteDialog } from "./ai-knowledge-delete-dialog";
import { AiKnowledgeTab } from "./ai-knowledge-tab";
import { AiPromptTab } from "./ai-prompt-tab";
import { AiTabsHeader } from "./ai-tabs-header";
import type {
  AiFormState,
  IndexStats,
  KnowledgeRecord,
  SiteOption,
} from "./ai-types";
import { useAiAdmin } from "./use-ai-admin";

export type { AiFormState, IndexStats, KnowledgeRecord } from "./ai-types";

export function AiClient({
  config,
  entries,
  sites,
  indexStats,
}: {
  config: AiFormState;
  entries: KnowledgeRecord[];
  sites: SiteOption[];
  indexStats: IndexStats;
}) {
  const admin = useAiAdmin(config, entries);

  return (
    <div className="max-w-5xl">
      <Tabs value={admin.tab} onValueChange={admin.setTab}>
        <AiTabsHeader
          tab={admin.tab}
          entryCount={entries.length}
          reindexing={admin.reindexing}
          testing={admin.testing}
          saving={admin.saving}
          onReindexAll={() => void admin.reindex()}
          onNewEntry={admin.newDraft}
          onTest={() => void admin.test()}
          onSave={() => void admin.save()}
        />

        <AiConnectionTab
          form={admin.form}
          modelOptions={admin.modelOptions}
          loadingModels={admin.loadingModels}
          testing={admin.testing}
          testPrompt={admin.testPrompt}
          testOutput={admin.testOutput}
          indexStats={indexStats}
          reindexing={admin.reindexing}
          onUpdate={admin.update}
          onToggleModel={admin.toggleModel}
          onLoadModels={() => void admin.loadModels()}
          onTest={() => void admin.test()}
          onReindex={(id) => void admin.reindex(id)}
          onTestPromptChange={admin.setTestPrompt}
        />

        <AiPromptTab form={admin.form} onUpdate={admin.update} />

        <AiKnowledgeTab
          entries={entries}
          filteredEntries={admin.filteredEntries}
          sites={sites}
          indexStats={indexStats}
          query={admin.query}
          draft={admin.draft}
          activeEntry={admin.activeEntry}
          dirty={admin.dirty}
          knowledgeSaving={admin.knowledgeSaving}
          reindexing={admin.reindexing}
          onQueryChange={admin.setQuery}
          onSelectEntry={admin.selectEntry}
          onDraftChange={admin.setDraft}
          onSave={() => void admin.saveKnowledge()}
          onCancel={admin.cancelDraft}
          onReindex={(id) => void admin.reindex(id)}
          onDelete={admin.setDeleting}
          onNew={admin.newDraft}
        />
      </Tabs>

      <AiKnowledgeDeleteDialog
        open={Boolean(admin.deleting)}
        onOpenChange={(open) => !open && admin.setDeleting(null)}
        onConfirm={() => void admin.deleteKnowledge()}
      />
    </div>
  );
}
