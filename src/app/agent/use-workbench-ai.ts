"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import type { AiSuggestionTrace } from "@/components/agent/workbench-types";

type AiOptions = {
  models: string[];
  defaultModel: string | null;
};

export function useWorkbenchAi({
  activeId,
  activeIdRef,
  ai,
  preferredModel,
}: {
  activeId: string | null;
  activeIdRef: { current: string | null };
  ai: AiOptions;
  preferredModel?: string;
}) {
  const t = useT();
  const [suggestion, setSuggestion] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const [aiTrace, setAiTrace] = useState<AiSuggestionTrace | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSuggestion(null);
    setAiTrace(null);
    setAiLoading(false);
    return () => {
      aiRequestRef.current?.abort();
      aiRequestRef.current = null;
    };
  }, [activeId]);

  const aiModelOptions = useMemo(() => {
    const list = [...ai.models];
    if (preferredModel && !list.includes(preferredModel)) {
      list.unshift(preferredModel);
    }
    return list;
  }, [ai.models, preferredModel]);

  const activeAiModel =
    preferredModel && aiModelOptions.includes(preferredModel)
      ? preferredModel
      : (ai.defaultModel ?? aiModelOptions[0] ?? "");

  async function generateSuggestion() {
    if (!activeId || aiRequestRef.current) return;
    const conversationId = activeId;
    const controller = new AbortController();
    aiRequestRef.current = controller;
    setAiLoading(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${activeId}/suggest`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: activeAiModel || undefined }),
          signal: controller.signal,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        model?: string;
        trace?: { name: string; summary: string; ok: boolean; ms: number }[];
        knowledge?: { title: string; score: number; via: string }[];
        error?: string;
      };
      if (controller.signal.aborted || activeIdRef.current !== conversationId) {
        return;
      }
      if (!response.ok || !data.text) {
        toast.error(data.error ?? t("workbench.aiFailed"));
        return;
      }
      setSuggestion({ conversationId, text: data.text });
      setAiTrace({
        model: data.model ?? activeAiModel,
        tools: data.trace ?? [],
        knowledge: data.knowledge ?? [],
      });
    } catch {
      if (!controller.signal.aborted && activeIdRef.current === conversationId) {
        toast.error(t("workbench.aiFailed"));
      }
    } finally {
      if (aiRequestRef.current === controller) {
        aiRequestRef.current = null;
        setAiLoading(false);
      }
    }
  }

  function clearSuggestion() {
    setSuggestion(null);
    setAiTrace(null);
  }

  function applySuggestion(apply: (text: string) => void) {
    if (!suggestion || suggestion.conversationId !== activeId) return;
    apply(suggestion.text);
    clearSuggestion();
  }

  return {
    aiSuggestion:
      suggestion?.conversationId === activeId ? suggestion.text : null,
    aiTrace,
    aiLoading,
    aiModelOptions,
    activeAiModel,
    generateSuggestion,
    applySuggestion,
    clearSuggestion,
  };
}