"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/admin/page-header";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  listAiModelsAction,
  rebuildKnowledgeIndexAction,
  saveAiSettingsAction,
  testAiAction,
  updateKnowledgeAction,
} from "@/server/actions/ai";
import { cn } from "@/lib/utils";

export type AiFormState = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 可以在客服工作台里切换的模型 */
  models: string[];
  assistantName: string;
  systemPrompt: string;
  autoReply: "off" | "no_agent" | "always";
  temperature: number;
  maxTokens: number;
  topK: number;
  historyLimit: number;
  enableEmbeddings: boolean;
  embeddingModel: string;
  enableTools: boolean;
  maxToolRounds: number;
};

export type KnowledgeRecord = {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  enabled: boolean;
  siteId: string | null;
  siteName: string | null;
  chunkCount: number;
};

export type IndexStats = {
  entries: number;
  chunks: number;
  vectorized: number;
};

type SiteOption = { id: string; name: string };

type KnowledgeDraft = {
  id: string | null;
  title: string;
  content: string;
  /** 逗号分隔，保存时再切成数组 */
  keywords: string;
  siteId: string;
  enabled: boolean;
};

const EMPTY_DRAFT: KnowledgeDraft = {
  id: null,
  title: "",
  content: "",
  keywords: "",
  siteId: "__global__",
  enabled: true,
};

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
        <TabsContent value="connection" className="mt-4 space-y-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4" />
                {t("ai.openaiCompat")}
              </CardTitle>
              <CardDescription>{t("ai.baseUrlHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">{t("ai.enabled")}</Label>
                <Switch
                  aria-label={t("ai.enabled")}
                  checked={form.enabled}
                  onCheckedChange={(value) => update("enabled", value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-base">{t("ai.baseUrl")}</Label>
                  <Input
                    id="ai-base"
                    value={form.baseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(event) => update("baseUrl", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-key">{t("ai.apiKey")}</Label>
                  <Input
                    id="ai-key"
                    type="password"
                    value={form.apiKey}
                    placeholder="sk-..."
                    onChange={(event) => update("apiKey", event.target.value)}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("ai.apiKeyHint")}
              </p>

              <Separator />

              <div className="space-y-2">
                <Label>{t("ai.model")}</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={form.model}
                    onValueChange={(value) => update("model", value)}
                  >
                    <SelectTrigger
                      aria-label={t("ai.model")}
                      className="min-w-0 w-full max-w-md sm:flex-1 [&>span]:truncate"
                    >
                      <SelectValue placeholder={t("ai.modelPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.length === 0 ? (
                        <SelectItem value="__empty__" disabled>
                          {t("ai.modelPlaceholder")}
                        </SelectItem>
                      ) : (
                        modelOptions.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingModels}
                    onClick={() => void handleLoadModels()}
                  >
                    {loadingModels ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    <span className="ml-1.5">{t("ai.modelRefresh")}</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("ai.modelsLabel")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {modelOptions.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {t("ai.modelsEmpty")}
                    </span>
                  ) : (
                    modelOptions.map((model) => {
                      const active = form.models.includes(model);
                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => toggleModel(model)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                            active
                              ? "border-primary/40 bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {active ? <Check className="size-3" /> : null}
                          {model}
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("ai.modelsHint")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="size-4" />
                {t("ai.capabilityTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-normal">
                        {t("ai.toolsLabel")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("ai.toolsHint")}
                      </p>
                    </div>
                    <Switch
                      aria-label={t("ai.toolsLabel")}
                      checked={form.enableTools}
                      onCheckedChange={(value) => update("enableTools", value)}
                    />
                  </div>
                  {form.enableTools ? (
                    <div className="space-y-2">
                      <Label htmlFor="ai-tool-rounds">
                        {t("ai.maxToolRounds")}
                      </Label>
                      <Input
                        id="ai-tool-rounds"
                        type="number"
                        min={1}
                        max={8}
                        className="max-w-[140px]"
                        value={form.maxToolRounds}
                        onChange={(event) =>
                          update(
                            "maxToolRounds",
                            Number(event.target.value) || 4,
                          )
                        }
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-normal">
                        {t("ai.embeddingsLabel")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("ai.embeddingsHint")}
                      </p>
                    </div>
                    <Switch
                      aria-label={t("ai.embeddingsLabel")}
                      checked={form.enableEmbeddings}
                      onCheckedChange={(value) =>
                        update("enableEmbeddings", value)
                      }
                    />
                  </div>
                  {form.enableEmbeddings ? (
                    <div className="space-y-2">
                      <Label htmlFor="ai-embedding-model">
                        {t("ai.embeddingModel")}
                      </Label>
                      <Input
                        id="ai-embedding-model"
                        value={form.embeddingModel}
                        placeholder="text-embedding-3-small"
                        onChange={(event) =>
                          update("embeddingModel", event.target.value)
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  {t("ai.indexStats", {
                    entries: indexStats.entries,
                    chunks: indexStats.chunks,
                    vectorized: indexStats.vectorized,
                  })}
                </p>
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
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                {t("ai.testPanelTitle")}
              </CardTitle>
              <CardDescription>{t("ai.testPanelHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={testPrompt}
                  onChange={(event) => setTestPrompt(event.target.value)}
                  placeholder={t("ai.testPrompt")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={testing}
                  onClick={() => void handleTest()}
                >
                  {testing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  <span className="ml-1.5">{t("ai.test")}</span>
                </Button>
              </div>
              {testOutput ? (
                <p className="bg-muted rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {testOutput}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- 提示词与策略 ---------------- */}
        <TabsContent value="prompt" className="mt-4 space-y-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                {t("ai.systemPrompt")}
              </CardTitle>
              <CardDescription>{t("ai.systemPromptHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-name">{t("ai.assistantName")}</Label>
                <Input
                  id="ai-name"
                  className="max-w-md"
                  value={form.assistantName}
                  onChange={(event) =>
                    update("assistantName", event.target.value)
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai.assistantNameHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-prompt">{t("ai.systemPrompt")}</Label>
                <Textarea
                  id="ai-prompt"
                  rows={16}
                  className="min-h-[360px] font-mono text-[13px] leading-relaxed"
                  value={form.systemPrompt}
                  onChange={(event) =>
                    update("systemPrompt", event.target.value)
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                {t("ai.behaviourTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("ai.autoReply")}</Label>
                <Select
                  value={form.autoReply}
                  onValueChange={(value) =>
                    update("autoReply", value as AiFormState["autoReply"])
                  }
                >
                  <SelectTrigger
                    aria-label={t("ai.autoReply")}
                    className="max-w-md"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">{t("ai.autoReplyOff")}</SelectItem>
                    <SelectItem value="no_agent">
                      {t("ai.autoReplyNoAgent")}
                    </SelectItem>
                    <SelectItem value="always">
                      {t("ai.autoReplyAlways")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-temp">{t("ai.temperature")}</Label>
                  <Input
                    id="ai-temp"
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={form.temperature}
                    onChange={(event) =>
                      update("temperature", Number(event.target.value) || 0)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-max">{t("ai.maxTokens")}</Label>
                  <Input
                    id="ai-max"
                    type="number"
                    min={64}
                    max={8000}
                    value={form.maxTokens}
                    onChange={(event) =>
                      update("maxTokens", Number(event.target.value) || 600)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-topk">{t("ai.topK")}</Label>
                  <Input
                    id="ai-topk"
                    type="number"
                    min={0}
                    max={20}
                    value={form.topK}
                    onChange={(event) =>
                      update("topK", Number(event.target.value) || 0)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-history">{t("ai.historyLimit")}</Label>
                  <Input
                    id="ai-history"
                    type="number"
                    min={0}
                    max={50}
                    value={form.historyLimit}
                    onChange={(event) =>
                      update("historyLimit", Number(event.target.value) || 0)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- 知识库 ---------------- */}
        <TabsContent value="knowledge" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <Card className="shadow-none">
              <CardContent className="space-y-3 p-3">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
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
                            setDraft({
                              id: entry.id,
                              title: entry.title,
                              content: entry.content,
                              keywords: entry.keywords.join(", "),
                              siteId: entry.siteId ?? "__global__",
                              enabled: entry.enabled,
                            })
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
                            <span className="text-muted-foreground">·</span>
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
                        setDraft({ ...draft, title: event.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="kb-keywords">
                      {t("ai.knowledgeKeywords")}
                    </Label>
                    <Input
                      id="kb-keywords"
                      value={draft.keywords}
                      placeholder="价格, 套餐, 多少钱"
                      onChange={(event) =>
                        setDraft({ ...draft, keywords: event.target.value })
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("ai.knowledgeKeywordsHint")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="kb-content">
                      {t("ai.knowledgeContent")}
                    </Label>
                    <Textarea
                      id="kb-content"
                      rows={18}
                      className="min-h-[380px] text-sm leading-relaxed"
                      value={draft.content}
                      onChange={(event) =>
                        setDraft({ ...draft, content: event.target.value })
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
                          setDraft({ ...draft, siteId: value })
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
                          setDraft({ ...draft, enabled: value })
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button
                      type="button"
                      disabled={knowledgeSaving}
                      onClick={() => void handleKnowledgeSave()}
                    >
                      {knowledgeSaving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      <span className="ml-1.5">{t("common.save")}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDraft(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                    {draft.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          void handleReindex(draft.id ?? undefined)
                        }
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
                        onClick={() => setDeleting(activeEntry)}
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
                  <Button
                    size="sm"
                    onClick={() => setDraft({ ...EMPTY_DRAFT })}
                  >
                    <Plus className="size-4" />
                    <span className="ml-1.5">{t("ai.knowledgeNew")}</span>
                  </Button>
                }
              />
            )}
          </div>
        </TabsContent>
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
