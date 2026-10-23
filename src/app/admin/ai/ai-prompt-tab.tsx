"use client";

import { useT } from "@/components/locale-provider";
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
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type { AiFormState, AiFormUpdater } from "./ai-types";

type AiPromptTabProps = {
  form: AiFormState;
  onUpdate: AiFormUpdater;
};

export function AiPromptTab({ form, onUpdate }: AiPromptTabProps) {
  const t = useT();

  return (
    <TabsContent value="prompt" className="mt-4 space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("ai.systemPrompt")}</CardTitle>
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
                onUpdate("assistantName", event.target.value)
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
                onUpdate("systemPrompt", event.target.value)
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("ai.behaviourTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("ai.autoReply")}</Label>
            <Select
              value={form.autoReply}
              onValueChange={(value) =>
                onUpdate("autoReply", value as AiFormState["autoReply"])
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
                  onUpdate("temperature", Number(event.target.value) || 0)
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
                  onUpdate("maxTokens", Number(event.target.value) || 600)
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
                  onUpdate("topK", Number(event.target.value) || 0)
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
                  onUpdate("historyLimit", Number(event.target.value) || 0)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
