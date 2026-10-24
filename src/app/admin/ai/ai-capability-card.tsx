"use client";

import { Loader2, RefreshCw, Wrench } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

import type {
  AiFormState,
  AiFormUpdater,
  IndexStats,
} from "./ai-types";

export function AiCapabilityCard({
  form,
  indexStats,
  reindexing,
  onUpdate,
  onReindex,
}: {
  form: AiFormState;
  indexStats: IndexStats;
  reindexing: string | null;
  onUpdate: AiFormUpdater;
  onReindex: (id?: string) => void;
}) {
  const t = useT();
  return (
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
  );
}
