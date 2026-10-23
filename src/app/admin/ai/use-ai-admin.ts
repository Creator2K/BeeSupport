"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { callClientAction } from "@/lib/client-action";
import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  listAiModelsAction,
  rebuildKnowledgeIndexAction,
  saveAiSettingsAction,
  testAiAction,
  updateKnowledgeAction,
} from "@/server/actions/ai";

import {
  filterKnowledgeEntries,
  knowledgeDraftFrom,
  knowledgeDraftIsDirty,
  knowledgeDraftPayload,
  modelOptionsFor,
} from "./ai-client-utils";
import {
  EMPTY_DRAFT,
  type AiFormState,
  type KnowledgeDraft,
  type KnowledgeRecord,
} from "./ai-types";

export function useAiAdmin(
  config: AiFormState,
  entries: KnowledgeRecord[],
) {
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
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function toggleModel(model: string) {
    setForm((previous) => ({
      ...previous,
      models: previous.models.includes(model)
        ? previous.models.filter((item) => item !== model)
        : [...previous.models, model],
    }));
  }

  async function loadModels() {
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

  async function save() {
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

  async function test() {
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

  async function reindex(knowledgeId?: string) {
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

  async function saveKnowledge() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error(t("ai.knowledgeRequired"));
      return;
    }

    setKnowledgeSaving(true);
    const payload = knowledgeDraftPayload(draft);
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
        setDraft((previous) =>
          previous ? { ...previous, id: created } : previous,
        );
      }
    }
    toast.success(
      draft.id ? t("ai.knowledgeUpdated") : t("ai.knowledgeCreated"),
    );
    router.refresh();
  }

  async function deleteKnowledge() {
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

  const modelOptions = modelOptionsFor(form, models);
  const filteredEntries = useMemo(
    () => filterKnowledgeEntries(entries, query),
    [entries, query],
  );
  const activeEntry = draft?.id
    ? (entries.find((entry) => entry.id === draft.id) ?? null)
    : null;
  const dirty = knowledgeDraftIsDirty(draft, activeEntry);

  return {
    tab,
    setTab,
    form,
    loadingModels,
    saving,
    testing,
    testPrompt,
    setTestPrompt,
    testOutput,
    reindexing,
    query,
    setQuery,
    draft,
    setDraft,
    knowledgeSaving,
    deleting,
    setDeleting,
    modelOptions,
    filteredEntries,
    activeEntry,
    dirty,
    update,
    toggleModel,
    loadModels,
    save,
    test,
    reindex,
    saveKnowledge,
    deleteKnowledge,
    selectEntry: (entry: KnowledgeRecord) => setDraft(knowledgeDraftFrom(entry)),
    newDraft: () => setDraft({ ...EMPTY_DRAFT }),
    cancelDraft: () => setDraft(null),
  };
}
