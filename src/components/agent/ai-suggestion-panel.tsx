"use client";

import { Sparkles } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

import type { AiSuggestionTrace } from "./workbench-types";

type AiSuggestionPanelProps = {
  text: string;
  trace: AiSuggestionTrace | null;
  onUse: () => void;
  onDismiss: () => void;
};

export function AiSuggestionPanel({
  text,
  trace,
  onUse,
  onDismiss,
}: AiSuggestionPanelProps) {
  const t = useT();

  return (
    <div className="animate-pop mb-2 rounded-lg border border-dashed p-2.5">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        <Sparkles className="size-3" />
        {t("workbench.aiSuggest")}
        {trace?.model ? (
          <span className="font-normal normal-case opacity-70">
            ? {trace.model}
          </span>
        ) : null}
      </div>
      <p className="chat-text text-sm leading-relaxed">{text}</p>

      {trace && (trace.tools.length > 0 || trace.knowledge.length > 0) ? (
        <div className="text-muted-foreground mt-1.5 space-y-0.5 text-[10px] leading-relaxed">
          {trace.tools.map((tool, index) => (
            <div key={`${tool.name}-${index}`}>
              {t("workbench.aiTools")} ? {tool.name} ? {tool.summary}
            </div>
          ))}
          {trace.knowledge.map((item, index) => (
            <div key={`${item.title}-${index}`}>
              {t("workbench.aiKnowledge")} ? {item.title}?{item.score}?
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onUse}>
          {t("workbench.aiUse")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("workbench.aiDismiss")}
        </Button>
      </div>
    </div>
  );
}
