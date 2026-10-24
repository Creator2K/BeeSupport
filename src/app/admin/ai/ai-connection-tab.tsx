"use client";

import { TabsContent } from "@/components/ui/tabs";

import { AiCapabilityCard } from "./ai-capability-card";
import { AiConnectionConfigCard } from "./ai-connection-config-card";
import { AiTestCard } from "./ai-test-card";
import type {
  AiFormState,
  AiFormUpdater,
  IndexStats,
} from "./ai-types";

type AiConnectionTabProps = {
  form: AiFormState;
  modelOptions: string[];
  loadingModels: boolean;
  testing: boolean;
  testPrompt: string;
  testOutput: string | null;
  indexStats: IndexStats;
  reindexing: string | null;
  onUpdate: AiFormUpdater;
  onToggleModel: (model: string) => void;
  onLoadModels: () => void;
  onTest: () => void;
  onReindex: (id?: string) => void;
  onTestPromptChange: (value: string) => void;
};

export function AiConnectionTab({
  form,
  modelOptions,
  loadingModels,
  testing,
  testPrompt,
  testOutput,
  indexStats,
  reindexing,
  onUpdate,
  onToggleModel,
  onLoadModels,
  onTest,
  onReindex,
  onTestPromptChange,
}: AiConnectionTabProps) {
  return (
    <TabsContent value="connection" className="mt-4 space-y-4">
      <AiConnectionConfigCard
        form={form}
        modelOptions={modelOptions}
        loadingModels={loadingModels}
        onUpdate={onUpdate}
        onToggleModel={onToggleModel}
        onLoadModels={onLoadModels}
      />
      <AiCapabilityCard
        form={form}
        indexStats={indexStats}
        reindexing={reindexing}
        onUpdate={onUpdate}
        onReindex={onReindex}
      />
      <AiTestCard
        testing={testing}
        testPrompt={testPrompt}
        testOutput={testOutput}
        onTest={onTest}
        onTestPromptChange={onTestPromptChange}
      />
    </TabsContent>
  );
}
