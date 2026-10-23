"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AiConnectionTab } from "./ai-connection-tab";
import { AiKnowledgeTab } from "./ai-knowledge-tab";
import { AiPromptTab } from "./ai-prompt-tab";
import {
  EMPTY_DRAFT,
  type AiFormState,
  type IndexStats,
  type KnowledgeDraft,
  type KnowledgeRecord,
  type SiteOption,
} from "./ai-types";
import { useT } from "@/components/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  listAiModelsAction,
  rebuildKnowledgeIndexAction,
  saveAiSettingsAction,
  testAiAction,
  updateKnowledgeAction,
} from "@/server/actions/ai";

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
  const t = useT();
  const router = useRouter();

  const [tab, setTab] = useState("connection");
  const [form, setForm] = useState<AiFormState>(config);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeRecord | null>(null);

  useEffect(() => {
    setTestPrompt(t("ai.testDefaultPrompt"));
  }, [t]);

  function update<K extends keyof AiFormState>(key: K, value: AiFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleModel(model: string) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.includes(model)
        ? prev.models.filter((item) => item !== model)
        : [...prev.models, model],
    }));
  }

  async function handleLoadModels() {
    setLoadingModels(true);
    setTestOutput(null);
    const result = await callClientAction(
      () =>
        listAiModelsAction({
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
        }),
      t("common.operationFailed"),
    );
    setLoadingModels(false);

    if (!result.ok || !result.models) {
      toast.error(result.error ?? t("ai.modelsFailed"));
      return;
    }

    setModels(result.models);
    if (!form.model || !result.models.includes(form.model)) {
      update("model", result.models[0] ?? "");
    }
    toast.success(t("ai.modelsLoaded", { count: result.models.length }));
  }

  async function handleSave() {
    setSaving(true);
    const result = await callClientAction(
      () => saveAiSettingsAction(form),
      t("common.operationFailed"),
    );
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("ai.saved"));
    router.refresh();
  }

  async function handleTest() {
    setTesting(true);
    setTestOutput(null);
    const result = await callClientAction(
      () => testAiAction({ ...form, prompt: testPrompt }),
      t("common.operationFailed"),
    );
    setTesting(false);

    if (!result.ok) {
      toast.error(result.error ?? t("ai.testFailed"));
      return;
    }
    setTestOutput(result.text ?? "");
    toast.success(t("ai.testOk"));
  }

  async function handleReindex(knowledgeId?: string) {
    setReindexing(knowledgeId ?? "__all__");
    const result = await callClientAction(
      () =>
        rebuildKnowledgeIndexAction({
          knowledgeId,
          useEmbeddings: form.enableEmbeddings,
        }),
      t("common.operationFailed"),
    );
    setReindexing(null);

    if (!result.ok) {
      toast.error(result.error ?? t("ai.reindexFailed"));
      return;
    }

    toast.success(
      t("ai.reindexDone", {
        chunks: result.result?.chunks ?? 0,
        embedded: result.result?.embedded ?? 0,
      }),
    );
    router.refresh();
  }

  async function handleKnowledgeSave() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error(t("ai.knowledgeRequired"));
      return;
    }

    setKnowledgeSaving(true);
    const payload = {
      title: draft.title,
      content: draft.content,
      keywords: draft.keywords
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      siteId: draft.siteId === "__global__" ? null : draft.siteId,
      enabled: draft.enabled,
    };

    const draftId = draft.id;
    const result = draftId
      ? await callClientAction(
          () => updateKnowledgeAction(draftId, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createKnowledgeAction(payload),
          t("common.operationFailed"),
        );
    setKnowledgeSaving(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (!draft.id) {
      const created = (result as { id?: string }).id;
      if (created) {
        setDraft((prev) => (prev ? { ...prev, id: created } : prev));
      }
    }
    toast.success(
      draft.id ? t("ai.knowledgeUpdated") : t("ai.knowledgeCreated"),
    );
    router.refresh();
  }

  async function handleKnowledgeDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteKnowledgeAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("ai.knowledgeDeleted"));
    if (draft?.id === deleting.id) setDraft(null);
    setDeleting(null);
    router.refresh();
  }

  const modelOptions = Array.from(
    new Set([...(form.model ? [form.model] : []), ...models, ...form.models]),
  );

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(keyword) ||
        entry.content.toLowerCase().includes(keyword) ||
        entry.keywords.some((item) => item.toLowerCase().includes(keyword)),
    );
  }, [entries, query]);

  const activeEntry = draft?.id
    ? (entries.find((entry) => entry.id === draft.id) ?? null)
    : null;

  const dirty = Boolean(
    draft &&
    (!activeEntry
      ? draft.title.trim() || draft.content.trim() || draft.keywords.trim()
      : activeEntry.title !== draft.title ||
        activeEntry.content !== draft.content ||
        activeEntry.enabled !== draft.enabled ||
        (activeEntry.siteId ?? "__global__") !== draft.siteId ||
        activeEntry.keywords.join(",") !==
          draft.keywords
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .join(",")),
  );

  return (
    <div className="max-w-5xl">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="connection">
              {t("ai.tabConnection")}
            </TabsTrigger>
            <TabsTrigger value="prompt">{t("ai.tabPrompt")}</TabsTrigger>
            <TabsTrigger value="knowledge">
              {t("ai.tabKnowledge")}
              <Badge
                variant="secondary"
                className="ml-1.5 h-4 px-1.5 text-[10px]"
              >
                {entries.length}
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
                onClick={() => void handleReindex()}
              >
                {reindexing === "__all__" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <span className="ml-1.5">{t("ai.reindex")}</span>
              </Button>
              <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
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
                onClick={() => void handleTest()}
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                <span className="ml-1.5">{t("ai.test")}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void handleSave()}
              >
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

        {/* ---------------- 接口与模型 ---------------- */}
        <AiConnectionTab
          form={form}
          modelOptions={modelOptions}
          loadingModels={loadingModels}
          testing={testing}
          testPrompt={testPrompt}
          testOutput={testOutput}
          indexStats={indexStats}
          reindexing={reindexing}
          onUpdate={update}
          onToggleModel={toggleModel}
          onLoadModels={() => void handleLoadModels()}
          onTest={() => void handleTest()}
          onReindex={(id) => void handleReindex(id)}
          onTestPromptChange={setTestPrompt}
        />

        <AiPromptTab form={form} onUpdate={update} />

        <AiKnowledgeTab
          entries={entries}
          filteredEntries={filteredEntries}
          sites={sites}
          indexStats={indexStats}
          query={query}
          draft={draft}
          activeEntry={activeEntry}
          dirty={dirty}
          knowledgeSaving={knowledgeSaving}
          reindexing={reindexing}
          onQueryChange={setQuery}
          onSelectEntry={(entry) =>
            setDraft({
              id: entry.id,
              title: entry.title,
              content: entry.content,
              keywords: entry.keywords.join(", "),
              siteId: entry.siteId ?? "__global__",
              enabled: entry.enabled,
            })
          }
          onDraftChange={setDraft}
          onSave={() => void handleKnowledgeSave()}
          onCancel={() => setDraft(null)}
          onReindex={(id) => void handleReindex(id)}
          onDelete={setDeleting}
          onNew={() => setDraft({ ...EMPTY_DRAFT })}
        />
      </Tabs>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("common.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleKnowledgeDelete()}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
