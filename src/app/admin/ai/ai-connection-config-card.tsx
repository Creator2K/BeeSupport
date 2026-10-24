"use client";

import { Bot, Check, Loader2, RefreshCw } from "lucide-react";

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
import { cn } from "@/lib/utils";

import type { AiFormState, AiFormUpdater } from "./ai-types";

export function AiConnectionConfigCard({
  form,
  modelOptions,
  loadingModels,
  onUpdate,
  onToggleModel,
  onLoadModels,
}: {
  form: AiFormState;
  modelOptions: string[];
  loadingModels: boolean;
  onUpdate: AiFormUpdater;
  onToggleModel: (model: string) => void;
  onLoadModels: () => void;
}) {
  const t = useT();
  return (
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
  );
}
