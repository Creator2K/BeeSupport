"use client";

import { Loader2, Sparkles } from "lucide-react";

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

export function AiTestCard({
  testing,
  testPrompt,
  testOutput,
  onTest,
  onTestPromptChange,
}: {
  testing: boolean;
  testPrompt: string;
  testOutput: string | null;
  onTest: () => void;
  onTestPromptChange: (value: string) => void;
}) {
  const t = useT();
  return (
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
  );
}
