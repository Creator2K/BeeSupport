"use client";

import { TabsContent } from "@/components/ui/tabs";

import { AiKnowledgeEditor } from "./ai-knowledge-editor";
import { AiKnowledgeList } from "./ai-knowledge-list";
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
  return (
    <TabsContent value="knowledge" className="mt-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <AiKnowledgeList
          entries={entries}
          filteredEntries={filteredEntries}
          indexStats={indexStats}
          query={query}
          draft={draft}
          onQueryChange={onQueryChange}
          onSelectEntry={onSelectEntry}
        />
        <AiKnowledgeEditor
          draft={draft}
          activeEntry={activeEntry}
          sites={sites}
          dirty={dirty}
          knowledgeSaving={knowledgeSaving}
          reindexing={reindexing}
          onDraftChange={onDraftChange}
          onSave={onSave}
          onCancel={onCancel}
          onReindex={onReindex}
          onDelete={onDelete}
          onNew={onNew}
        />
      </div>
    </TabsContent>
  );
}
