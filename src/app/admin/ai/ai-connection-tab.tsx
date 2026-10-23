"use client";

import {
  Bot,
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
  const t = useT();

  return (
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
              onCheckedChange={(value) => onUpdate("enabled", value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-base">{t("ai.baseUrl")}</Label>
              <Input
                id="ai-base"
                value={form.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => onUpdate("baseUrl", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-key">{t("ai.apiKey")}</Label>
              <Input
                id="ai-key"
                type="password"
                value={form.apiKey}
                placeholder="sk-..."
                onChange={(event) => onUpdate("apiKey", event.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t("ai.apiKeyHint")}</p>

          <Separator />

          <div className="space-y-2">
            <Label>{t("ai.model")}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={form.model}
                onValueChange={(value) => onUpdate("model", value)}
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
                onClick={onLoadModels}
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
                      onClick={() => onToggleModel(model)}
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
            <p className="text-muted-foreground text-xs">{t("ai.modelsHint")}</p>
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
                  onCheckedChange={(value) => onUpdate("enableTools", value)}
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
                      onUpdate(
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
                    onUpdate("enableEmbeddings", value)
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
                      onUpdate("embeddingModel", event.target.value)
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
              onClick={() => onReindex()}
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
          <CardTitle className="text-base">{t("ai.testPanelTitle")}</CardTitle>
          <CardDescription>{t("ai.testPanelHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={testPrompt}
              onChange={(event) => onTestPromptChange(event.target.value)}
              placeholder={t("ai.testPrompt")}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={testing}
              onClick={onTest}
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
  );
}
